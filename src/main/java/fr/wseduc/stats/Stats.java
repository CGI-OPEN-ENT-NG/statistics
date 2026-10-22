/*
 * Copyright © "Open Digital Education" (SAS “WebServices pour l’Education”), 2014
 *
 * This program is published by "Open Digital Education" (SAS “WebServices pour l’Education”).
 * You must indicate the name of the software and the company in any production /contribution
 * using the software and indicate on the home page of the software industry in question,
 * "powered by Open Digital Education" with a reference to the website: https: //opendigitaleducation.com/.
 *
 * This program is free software, licensed under the terms of the GNU Affero General Public License
 * as published by the Free Software Foundation, version 3 of the License.
 *
 * You can redistribute this application and/or modify it since you respect the terms of the GNU Affero General Public License.
 * If you modify the source code and then use this modified source code in your creation, you must make available the source code of your modifications.
 *
 * You should have received a copy of the GNU Affero General Public License along with the software.
 * If not, please see : <http://www.gnu.org/licenses/>. Full compliance requires reading the terms of this license and following its directives.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 */

package fr.wseduc.stats;

import java.io.File;
import java.text.ParseException;
import java.time.LocalDate;
import java.util.Base64;
import java.util.Map;

import fr.wseduc.webutils.collections.SharedDataHelper;
import fr.wseduc.webutils.data.FileResolver;
import io.vertx.core.Future;
import io.vertx.core.Handler;
import io.vertx.core.Promise;
import io.vertx.pgclient.PgConnectOptions;
import io.vertx.pgclient.PgPool;
import io.vertx.pgclient.SslMode;
import io.vertx.sqlclient.PoolOptions;
import io.vertx.sqlclient.Tuple;
import org.entcore.common.aggregation.MongoConstants.COLLECTIONS;
import org.entcore.common.events.EventHelper;
import org.entcore.common.events.EventStore;
import org.entcore.common.events.EventStoreFactory;
import org.entcore.common.http.BaseServer;
import org.entcore.common.mongodb.MongoDbConf;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;
import io.vertx.core.logging.Logger;
import io.vertx.core.logging.LoggerFactory;

import fr.wseduc.cron.CronTrigger;
import fr.wseduc.stats.controllers.JobsController;
import fr.wseduc.stats.controllers.StatsController;
import fr.wseduc.stats.cron.CronAggregationTask;
import fr.wseduc.stats.cron.PgAggregationTask;
import fr.wseduc.stats.filters.WorkflowFilter;
import fr.wseduc.stats.services.DefaultJobsServiceImpl;
import fr.wseduc.stats.services.MockStatsService;
import fr.wseduc.stats.services.PGStatsService;
import fr.wseduc.stats.services.StatsService;
import fr.wseduc.stats.services.StatsServiceMongoImpl;

import com.opendigitaleducation.repository.SyncRepository;

public class Stats extends BaseServer {

	private static final Logger logger = LoggerFactory.getLogger(Stats.class);
	private static final int REGISTER_PLATFORM_ATTEMPTS = 10;
	private static final long REGISTER_PLATFORM_DELAY = 30000L;
	private static final String PARTITIONS_SCRIPT = "004-partitions.sql";
	// seconds: idle connections are closed before the network drops them (aggregation once a night)
	private static final int DEFAULT_PG_IDLE_TIMEOUT = 60;

	@Override
	public void start(final Promise<Void> startPromise) throws Exception {
		Promise<Void> promise = Promise.promise();
		super.start(promise);
		promise.future()
				.compose(init -> SharedDataHelper.getInstance().getLocalMulti("server", "event-store", "neo4jConfig"))
				.compose(statsConfigMap -> initStats(statsConfigMap))
				.onComplete(startPromise);
	}

	private Future<Void> initStats(final Map<String, Object> statsConfigMap) {

		// CRON
		// Default at 00:00AM every day
		final String aggregationCron = config.getString("aggregation-cron");
		// Day delta, default : processes yesterday events
		int dayDelta = config.getInteger("dayDelta", -1);
		final boolean aggregationEnabled = aggregationCron != null && !aggregationCron.trim().isEmpty();
		// PostgreSQL aggregation on a single node of the platform
		final boolean pgAggregation = config.getBoolean("pg-aggregation", false);

		final String platformId;
		final String eventStoreConf = (String) statsConfigMap.get("event-store");
		final JsonObject eventStoreConfig;
		if (eventStoreConf != null) {
			eventStoreConfig = new JsonObject(eventStoreConf);
			platformId = eventStoreConfig.getString("platform");
		} else {
			platformId = null;
			eventStoreConfig = null;
		}

		final StatsService statsService;
		final JsonObject readPGConfig = config.getJsonObject("read-pg-config");
		final JsonObject pgConfig = config.getJsonObject("pg-config");
		final boolean oldStats = config.getBoolean("mongo-stats-service", false);
		if (pgConfig != null && !pgConfig.isEmpty() && !oldStats) {
			final PgConnectOptions connectOptions = new PgConnectOptions().setPort(pgConfig.getInteger("port", 5432))
					.setHost(pgConfig.getString("host")).setDatabase(pgConfig.getString("database"))
					.setUser(pgConfig.getString("user")).setPassword(pgConfig.getString("password"))
					.setIdleTimeout(pgConfig.getInteger("idle-timeout", DEFAULT_PG_IDLE_TIMEOUT));
			final SslMode sslMode = SslMode.valueOf(pgConfig.getString("ssl-mode", "DISABLE"));
			if (!SslMode.DISABLE.equals(sslMode)) {
				connectOptions.setSslMode(sslMode).setTrustAll(SslMode.ALLOW.equals(sslMode) || SslMode.PREFER.equals(sslMode) || SslMode.REQUIRE.equals(sslMode));
			}
			PoolOptions poolOptions = new PoolOptions().setMaxSize(pgConfig.getInteger("pool-size", 5));
			PgPool pgPool = PgPool.pool(vertx, connectOptions, poolOptions);
			final Promise<Void> platformRegistered = Promise.promise();
			if (platformId != null) {
				registerPlatform(pgPool, platformId, 1, platformRegistered);
			} else {
				platformRegistered.complete();
			}

			// SyncRepository with neo4j config
			final String neo4jConfig = (String) statsConfigMap.get("neo4jConfig");
			final JsonObject neo4jConfigJson = new JsonObject(neo4jConfig);
			final String neo4jUserName = neo4jConfigJson.getString("username");
			final String neo4jPassword = neo4jConfigJson.getString("password");
			final String neo4jUri = neo4jConfigJson.getJsonArray("server-uris",
					new JsonArray().add(neo4jConfigJson.getString("server-uri"))).getString(0).replaceAll("/+$", "");
			final JsonObject syncRepositoryConfig = new JsonObject()
					.put("neo4j-uri", neo4jUri)
					.put("platform-id", platformId)
					.put("neo4j-auth", Base64.getEncoder().encodeToString((neo4jUserName + ":" + neo4jPassword).getBytes()));
			final JsonArray platforms = new JsonArray().add(syncRepositoryConfig);
			final SyncRepository syncRepository = new SyncRepository(vertx, platforms);

			final DefaultJobsServiceImpl jobsService = new DefaultJobsServiceImpl(vertx, platformId, config.getJsonObject("api-allowed-values"));
			jobsService.setPgPool(pgPool);
			jobsService.setSyncRepository(syncRepository);
			final JobsController jobsController = new JobsController();
			jobsController.setJobsService(jobsService);
			addController(jobsController);

			if (aggregationEnabled && pgAggregation) {
				// start of the aggregation of empty stats tables, read by the aggregator in the module config
				final LocalDate today = LocalDate.now();
				config.put("init-year", config.getInteger("init-year", today.getYear()));
				config.put("init-month", config.getInteger("init-month", today.getMonthValue()));
				// partitions created as the admin user, like the sql scripts of the module (owner of the events tables)
				final String sqlAdminAddress = config.getJsonObject("postgresConfig", new JsonObject())
						.getString("sqlAdminAdress", "sql.persistor.admin");
				final String partitionsScript = FileResolver.absolutePath(config.getString("init-scripts", "sql"))
						+ File.separator + PARTITIONS_SCRIPT;
				final PgAggregationTask aggregationTask = new PgAggregationTask(vertx, pgPool, platforms, platformId,
						syncRepository, sqlAdminAddress, partitionsScript, config.getBoolean("enable-with-device-aggregation", true));
				final Future<Void> scheduled = scheduleAggregation(aggregationCron, aggregationTask);
				if (scheduled.failed()) {
					return scheduled;
				}
				// repository up to date at startup: needed by the history migration of a first installation
				platformRegistered.future().onSuccess(v -> aggregationTask.syncRepositoryAtStartup());
			}
		} else if (aggregationEnabled) {
			final Future<Void> scheduled = scheduleAggregation(aggregationCron, new CronAggregationTask(dayDelta));
			if (scheduled.failed()) {
				return scheduled;
			}
		}
		if (Boolean.TRUE.equals(config.getBoolean("mock", false))) {
			statsService = new MockStatsService(vertx, config.getString("mocks-path"));
		} else if (readPGConfig != null && !readPGConfig.isEmpty() && !oldStats) {
			final PgConnectOptions connectOptions = new PgConnectOptions().setPort(readPGConfig.getInteger("port", 5432))
					.setHost(readPGConfig.getString("host")).setDatabase(readPGConfig.getString("database"))
					.setUser(readPGConfig.getString("user")).setPassword(readPGConfig.getString("password"))
					.setIdleTimeout(readPGConfig.getInteger("idle-timeout", DEFAULT_PG_IDLE_TIMEOUT));
			final SslMode sslMode = SslMode.valueOf(readPGConfig.getString("ssl-mode", "DISABLE"));
			if (!SslMode.DISABLE.equals(sslMode)) {
				connectOptions.setSslMode(sslMode).setTrustAll(SslMode.ALLOW.equals(sslMode) || SslMode.PREFER.equals(sslMode) || SslMode.REQUIRE.equals(sslMode));
			}
			PoolOptions poolOptions = new PoolOptions().setMaxSize(readPGConfig.getInteger("pool-size", 5));
			PgPool pgPool = PgPool.pool(vertx, connectOptions, poolOptions);
			statsService = new PGStatsService(platformId, config.getJsonObject("api-allowed-values"));
			((PGStatsService) statsService).setReadPgPool(pgPool);
		} else if (eventStoreConfig != null && eventStoreConfig.getJsonObject("postgresql-slave") != null && !oldStats) {
			final JsonObject eventStorePGConfig = eventStoreConfig.getJsonObject("postgresql-slave");
			final PgConnectOptions connectOptions = new PgConnectOptions()
				.setPort(eventStorePGConfig.getInteger("port", 5432))
				.setHost(eventStorePGConfig.getString("host"))
				.setDatabase(eventStorePGConfig.getString("database"))
				.setUser(eventStorePGConfig.getString("user"))
				.setPassword(eventStorePGConfig.getString("password"))
				.setIdleTimeout(eventStorePGConfig.getInteger("idle-timeout", DEFAULT_PG_IDLE_TIMEOUT));
			final SslMode sslMode = SslMode.valueOf(eventStorePGConfig.getString("ssl-mode", "DISABLE"));
			if (!SslMode.DISABLE.equals(sslMode)) {
				connectOptions.setSslMode(sslMode).setTrustAll(SslMode.ALLOW.equals(sslMode) || SslMode.PREFER.equals(sslMode) || SslMode.REQUIRE.equals(sslMode));
			}
			PoolOptions poolOptions = new PoolOptions().setMaxSize(eventStorePGConfig.getInteger("pool-size", 5));
			PgPool pgPool = PgPool.pool(vertx, connectOptions, poolOptions);
			statsService = new PGStatsService(platformId, config.getJsonObject("api-allowed-values"));
			((PGStatsService) statsService).setReadPgPool(pgPool);
        } else {
			statsService = new StatsServiceMongoImpl(COLLECTIONS.stats.name());
		}

		final StatsController statsController = new StatsController(COLLECTIONS.stats.name());
		statsController.setStatsService(statsService);
		final EventStore eventStore = EventStoreFactory.getFactory().getEventStore(Stats.class.getSimpleName());
		final EventHelper eventHelper =  new EventHelper(eventStore);
		statsController.setEventHelper(eventHelper);

		// REST BASICS
		addController(statsController);
		MongoDbConf.getInstance().setCollection(COLLECTIONS.stats.name());
		addFilter(new WorkflowFilter(this.vertx.eventBus(), "stats.view", "fr.wseduc.stats.controllers.StatsController|view"));
		return Future.succeededFuture();
	}

	private Future<Void> scheduleAggregation(final String aggregationCron, final Handler<Long> task) {
		try {
			new CronTrigger(vertx, aggregationCron).schedule(task);
			return Future.succeededFuture();
		} catch (ParseException e) {
			logger.fatal(e.getMessage(), e);
			vertx.close();
			return Future.failedFuture(e);
		}
	}

	/**
	 * Register the platform of the events (event-store.platform) in repository.platforms, required by the stats aggregator.
	 * Retried while the tables are created by the sql scripts of the module (run asynchronously by BaseServer).
	 */
	private void registerPlatform(final PgPool pgPool, final String platformId, final int attempt, final Promise<Void> promise) {
		final Tuple platform = Tuple.of(platformId, config.getString("platform-name", platformId),
				config.getString("platform-timezone", "Europe/Paris"));
		pgPool.preparedQuery("INSERT INTO repository.platforms (id, name, timezone) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING")
				.execute(platform, ar -> {
					if (ar.succeeded()) {
						promise.complete();
					} else if (attempt < REGISTER_PLATFORM_ATTEMPTS) {
						vertx.setTimer(REGISTER_PLATFORM_DELAY, t -> registerPlatform(pgPool, platformId, attempt + 1, promise));
					} else {
						logger.error("Error registering platform " + platformId + " in repository.platforms", ar.cause());
						promise.fail(ar.cause());
					}
				});
	}

}
