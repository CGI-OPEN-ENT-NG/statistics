package fr.wseduc.stats.cron;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.Collectors;

import org.entcore.common.neo4j.Neo4j;
import org.entcore.common.neo4j.Neo4jResult;
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
	private static final String CAMPUS_PROFILES_QUERY =
			"MATCH (u:User) OPTIONAL MATCH (u)-[:HAS_PROFILE]->(k:KC_Profile) " +
			"RETURN u.id AS id, collect(DISTINCT k.name) AS profiles";
	private static final String UPDATE_PROFILE =
			"UPDATE repository.users SET profile = $1 WHERE id = $2 AND platform_id = $3 AND profile IS DISTINCT FROM $1";
	private static final int UPDATE_BATCH_SIZE = 1000;
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
	private final JsonObject campusProfiles;
	private final boolean deviceAggregation;
	private final AtomicBoolean running = new AtomicBoolean(false);

	/**
	 * @param partitionsScript sql script creating the partitions, run as the admin user (owner of the events tables)
	 * @param campusProfiles config of the profiles of the repository users (campus-profiles), null to keep the ENT ones
	 * @param deviceAggregation enable-with-device-aggregation: device type of the logins detected before the aggregation
	 */
	public PgAggregationTask(Vertx vertx, PgPool pgPool, JsonArray platforms, String platformId,
			SyncRepository syncRepository, String sqlAdminAddress, String partitionsScript, JsonObject campusProfiles,
			boolean deviceAggregation) {
		this.vertx = vertx;
		this.pgPool = pgPool;
		this.platforms = platforms;
		this.platformId = platformId;
		this.syncRepository = syncRepository;
		this.sqlAdmin = Sql.createInstance(vertx.eventBus(), sqlAdminAddress);
		this.partitionsScript = partitionsScript;
		this.campusProfiles = campusProfiles;
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
				.compose(v -> updateCampusProfiles())
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
		syncRepository().compose(v -> updateCampusProfiles()).onComplete(ar -> {
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
	 * Campus profile (name of the KC_Profile nodes of the user in Neo4j) as profile of the repository users, used by
	 * the aggregator for the loaded / activated accounts: the profile if the user has one, one of them picked from the
	 * hash of the user id if he has several (they depend on the structure; same pick every night and in
	 * scripts/campus_profiles.py), campus-profiles.none ("Invité") if he has none.
	 * The repository synchronization writes the ENT profile again, so it runs after each one.
	 */
	private Future<Void> updateCampusProfiles() {
		if (campusProfiles == null || platformId == null) {
			return Future.succeededFuture();
		}
		final String none = campusProfiles.getString("none", "Invité");
		final Promise<JsonArray> users = Promise.promise();
		Neo4j.getInstance().execute(CAMPUS_PROFILES_QUERY, new JsonObject(), Neo4jResult.validResultHandler(either -> {
			if (either.isRight()) {
				users.complete(either.right().getValue());
			} else {
				users.fail("Error reading the Campus profiles in Neo4j : " + either.left().getValue());
			}
		}));
		return users.future().compose(result -> {
			final List<Tuple> updates = new ArrayList<>();
			for (Object o : result) {
				final JsonObject user = (JsonObject) o;
				final List<String> profiles = user.getJsonArray("profiles", new JsonArray()).stream()
						.filter(p -> p instanceof String).map(p -> (String) p).sorted().collect(Collectors.toList());
				final String id = user.getString("id");
				final String profile = profiles.isEmpty() ? none : profiles.get(personIndex(id) % profiles.size());
				updates.add(Tuple.of(profile, id, platformId));
			}
			Future<Void> chain = Future.succeededFuture();
			for (int i = 0; i < updates.size(); i += UPDATE_BATCH_SIZE) {
				final List<Tuple> batch = updates.subList(i, Math.min(i + UPDATE_BATCH_SIZE, updates.size()));
				chain = chain.compose(v -> pgPool.preparedQuery(UPDATE_PROFILE).executeBatch(batch).mapEmpty());
			}
			return chain.onSuccess(v -> log.info("[Aggregation][PostgreSQL] Campus profiles of " + updates.size() + " users"));
		});
	}

	/**
	 * Stable pseudo-random index of a person: first 7 hexadecimal digits of md5(user id), as person_index of
	 * scripts/campus_profiles.py.
	 */
	static int personIndex(String userId) {
		try {
			final byte[] md5 = MessageDigest.getInstance("MD5").digest((userId == null ? "" : userId).getBytes(StandardCharsets.UTF_8));
			final StringBuilder hex = new StringBuilder();
			for (int i = 0; i < 4; i++) {
				hex.append(String.format("%02x", md5[i]));
			}
			return Integer.parseInt(hex.substring(0, 7), 16);
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
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
