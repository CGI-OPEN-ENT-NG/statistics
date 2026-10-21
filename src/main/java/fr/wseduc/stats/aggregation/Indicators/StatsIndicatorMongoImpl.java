package fr.wseduc.stats.aggregation.Indicators;

import org.entcore.common.aggregation.MongoConstants.COLLECTIONS;

import org.bson.conversions.Bson;
import org.entcore.common.aggregation.indicators.mongo.IndicatorMongoImpl;

import fr.wseduc.mongodb.MongoQueryBuilder;
import fr.wseduc.mongodb.MongoUpdateBuilder;
import io.vertx.core.Handler;
import io.vertx.core.eventbus.Message;
import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

public class StatsIndicatorMongoImpl extends IndicatorMongoImpl {

	public StatsIndicatorMongoImpl(String key) {
		super(key);
	}

	@Override
	protected void writeAction(Bson criteriaQuery, int resultsCount, Handler<Message<JsonObject>> handler) {
		final JsonObject criteria = new JsonObject();
		flatten(MongoQueryBuilder.build(criteriaQuery), criteria);
		mongo.update(COLLECTIONS.stats.name(),
				criteria,
				new MongoUpdateBuilder().inc(getWriteKey(), resultsCount).build(),
				true,
				true,
				handler);
	}

	private static void flatten(JsonObject query, JsonObject criteria) {
		for (String field : query.fieldNames()) {
			final Object value = query.getValue(field);
			if ("$and".equals(field) && value instanceof JsonArray) {
				for (Object clause : (JsonArray) value) {
					if (clause instanceof JsonObject) {
						flatten((JsonObject) clause, criteria);
					}
				}
			} else {
				criteria.remove(field);
				criteria.put(field, value);
			}
		}
	}
}
