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

package fr.wseduc.stats.aggregation.Indicators;


import static org.entcore.common.aggregation.MongoConstants.*;

import io.vertx.core.json.JsonArray;
import io.vertx.core.json.JsonObject;

/**
 * Indicator to measure unique visitors.
 */
public class UniqueVisitorIndicator extends StatsIndicatorMongoImpl{

	public static final String STATS_UNIQUEVISITORS_KEY = "UNIQUE_VISITORS";

	public UniqueVisitorIndicator(){
		super(TRACE_TYPE_CONNEXION);
		this.setWriteKey(STATS_UNIQUEVISITORS_KEY);
	}

	@Override
	protected void customizeGroupBy(JsonObject groupBy){
		groupBy
			.getJsonObject("$group", new JsonObject())
				.put("userIds", new JsonObject()
					.put("$addToSet", "$"+TRACE_FIELD_USER));
	}

	@Override
	protected void customizePipeline(JsonArray pipeline){
		pipeline.add(new JsonObject()
			.put("$project", new JsonObject()
				.put("count", new JsonObject()
					.put("$size", "$userIds"))));
	}
}
