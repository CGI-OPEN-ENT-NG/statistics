package fr.wseduc.stats.cron;

import java.time.LocalDate;
import java.util.Collections;
import java.util.concurrent.atomic.AtomicBoolean;

import org.entcore.common.sql.Sql;

import com.opendigitaleducation.repository.SyncRepository;
import com.opendigitaleducation.stats.aggregation.Aggregator;
import com.opendigitaleducation.stats.aggregation.DeviceDetectorTask;

import io.vertx.core.Future;
import io.vertx.core.Handler;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;
import io.vertx.pgclient.PgPool;
import io.vertx.sqlclient.Tuple;

/**
 * PostgreSQL statistics: next monthly partitions of the events tables, repository synchronization from Neo4j,
 * then aggregation of the events into the stats tables (edificeio/stats aggregator, options read in the module config).
 */
public class PgAggregationTask implements Handler<Long> {

	private static final Logger log = LoggerFactory.getLogger(PgAggregationTask.class);
	// device type written by the event store when it does not recognize the browser: detected again from the user agent
	private static final String RESET_UNKNOWN_DEVICES =
			"UPDATE events.login_events SET device_type = NULL WHERE device_type = 'Unknown' AND ua IS NOT NULL";

	private final Vertx vertx;
	private final PgPool pgPool;
	private final JsonArray platforms;
	private final String platformId;
	private final SyncRepository syncRepository;
	private final Sql sqlAdmin;
	private final String partitionsScript;
	private final boolean deviceAggregation;
	private final AtomicBoolean running = new AtomicBoolean(false);

	/**
	 * @param partitionsScript sql script creating the partitions, run as the admin user (owner of the events tables)
	 * @param deviceAggregation enable-with-device-aggregation: device type of the logins detected before the aggregation
	 */
	public PgAggregationTask(Vertx vertx, PgPool pgPool, JsonArray platforms, String platformId,
			SyncRepository syncRepository, String sqlAdminAddress, String partitionsScript, boolean deviceAggregation) {
		this.vertx = vertx;
		this.pgPool = pgPool;
		this.platforms = platforms;
		this.platformId = platformId;
		this.syncRepository = syncRepository;
		this.sqlAdmin = Sql.createInstance(vertx.eventBus(), sqlAdminAddress);
		this.partitionsScript = partitionsScript;
		this.deviceAggregation = deviceAggregation;
	}

	@Override
	public void handle(Long event) {
		if (!running.compareAndSet(false, true)) {
			log.warn("[Aggregation][PostgreSQL] Previous aggregation still running, skipped");
			return;
		}
		final long start = System.currentTimeMillis();
		log.info("[Aggregation][PostgreSQL] Start");
		createPartitions()
				.compose(v -> syncRepository())
				.compose(v -> detectDevices())
				.compose(v -> aggregateDeviceHistory())
				.compose(v -> aggregate())
				.onComplete(ar -> {
					running.set(false);
					if (ar.succeeded()) {
						log.info("[Aggregation][PostgreSQL] Success in " + (System.currentTimeMillis() - start) + " ms");
					} else {
						log.error("[Aggregation][PostgreSQL] Error", ar.cause());
					}
				});
	}

	/**
	 * Repository synchronization alone, at the start of the module.
	 */
	public void syncRepositoryAtStartup() {
		if (!running.compareAndSet(false, true)) {
			return;
		}
		syncRepository().onComplete(ar -> {
			running.set(false);
			if (ar.succeeded()) {
				log.info("[Aggregation][PostgreSQL] Repository synchronized at startup");
			} else {
				log.error("[Aggregation][PostgreSQL] Error synchronizing the repository at startup", ar.cause());
			}
		});
	}

	private Future<Void> createPartitions() {
		return vertx.fileSystem().readFile(partitionsScript).compose(script -> {
			final Promise<Void> promise = Promise.promise();
			sqlAdmin.raw(script.toString(), message -> {
				final JsonObject body = message.body();
				if ("ok".equals(body.getString("status"))) {
					promise.complete();
				} else {
					promise.fail("Error creating partitions : " + body.getString("message"));
				}
			});
			return promise.future();
		});
	}

	private Future<Void> syncRepository() {
		final Promise<Void> promise = Promise.promise();
		syncRepository.setMasterPgPool(pgPool);
		syncRepository.setSlavePgPool(pgPool);
		syncRepository.sync(promise);
		return promise.future();
	}

	/**
	 * Device type (desktop, smartphone, tablet, mobile_app...) of the logins from their user agent, like the
	 * run-periodic-device-detector action of the aggregator: logins without device type since device-init-date
	 * (yesterday by default), the matches being kept in utils.ua_device. Used by the device aggregations.
	 */
	private Future<Void> detectDevices() {
		if (!deviceAggregation) {
			return Future.succeededFuture();
		}
		final Promise<Void> promise = Promise.promise();
		pgPool.query(RESET_UNKNOWN_DEVICES).execute().onComplete(reset -> {
			if (reset.failed()) {
				promise.fail(reset.cause());
				return;
			}
			new DeviceDetectorTask(vertx, Collections.singletonList("events.login_events"), pgPool, pgPool).execute(promise);
		});
		return promise.future();
	}

	/**
	 * Device tables still empty: aggregated once from device-init-date to today (dates-interval of the aggregator),
	 * the other tables being left aside. Then the usual aggregation goes on from their last date: with
	 * paginate-interval it only aggregates a page (a week, 2 months) per run, and never leaves an empty first page.
	 */
	private Future<Void> aggregateDeviceHistory() {
		final JsonObject conf = vertx.getOrCreateContext().config();
		final String from = conf.getString("device-init-date");
		if (!deviceAggregation || from == null || conf.containsKey("dates-interval")) {
			return Future.succeededFuture();
		}
		return pgPool.preparedQuery("SELECT 1 FROM stats.accounts_device_platform_days WHERE platform_id = $1 LIMIT 1")
				.execute(Tuple.of(platformId)).compose(rows -> {
					if (rows.size() > 0) {
						return Future.succeededFuture();
					}
					log.info("[Aggregation][PostgreSQL] Device history from " + from);
					final Object withoutDevice = conf.getValue("enable-without-device-aggregation");
					conf.put("dates-interval", new JsonObject().put("min-date", from)
							.put("max-date", LocalDate.now().atStartOfDay().toString()));
					conf.put("enable-without-device-aggregation", false);
					return aggregate().onComplete(ar -> {
						conf.remove("dates-interval");
						if (withoutDevice == null) {
							conf.remove("enable-without-device-aggregation");
						} else {
							conf.put("enable-without-device-aggregation", withoutDevice);
						}
					});
				});
	}

	private Future<Void> aggregate() {
		final Promise<Void> promise = Promise.promise();
		final Aggregator aggregator = new Aggregator(vertx, platforms);
		aggregator.setMasterPgPool(pgPool);
		aggregator.setSlavePgPool(pgPool);
		aggregator.aggregate(promise);
		return promise.future();
	}

}
