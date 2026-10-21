package fr.wseduc.stats.cron;

import java.util.concurrent.atomic.AtomicBoolean;

import org.entcore.common.sql.Sql;

import com.opendigitaleducation.repository.SyncRepository;
import com.opendigitaleducation.stats.aggregation.Aggregator;

import io.vertx.core.Future;
import io.vertx.core.Handler;
import io.vertx.core.Promise;
import io.vertx.core.Vertx;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;
import io.vertx.pgclient.PgPool;

/**
 * PostgreSQL statistics: next monthly partitions of the events tables, repository synchronization from Neo4j,
 * then aggregation of the events into the stats tables (edificeio/stats aggregator, options read in the module config).
 */
public class PgAggregationTask implements Handler<Long> {

	private static final Logger log = LoggerFactory.getLogger(PgAggregationTask.class);

	private final Vertx vertx;
	private final PgPool pgPool;
	private final JsonArray platforms;
	private final SyncRepository syncRepository;
	private final Sql sqlAdmin;
	private final String partitionsScript;
	private final AtomicBoolean running = new AtomicBoolean(false);

	/**
	 * @param partitionsScript sql script creating the partitions, run as the admin user (owner of the events tables)
	 */
	public PgAggregationTask(Vertx vertx, PgPool pgPool, JsonArray platforms, SyncRepository syncRepository,
			String sqlAdminAddress, String partitionsScript) {
		this.vertx = vertx;
		this.pgPool = pgPool;
		this.platforms = platforms;
		this.syncRepository = syncRepository;
		this.sqlAdmin = Sql.createInstance(vertx.eventBus(), sqlAdminAddress);
		this.partitionsScript = partitionsScript;
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

	private Future<Void> aggregate() {
		final Promise<Void> promise = Promise.promise();
		final Aggregator aggregator = new Aggregator(vertx, platforms);
		aggregator.setMasterPgPool(pgPool);
		aggregator.setSlavePgPool(pgPool);
		aggregator.aggregate(promise);
		return promise.future();
	}

}
