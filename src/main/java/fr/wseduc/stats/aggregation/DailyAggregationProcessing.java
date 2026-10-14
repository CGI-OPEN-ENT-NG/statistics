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

package fr.wseduc.stats.aggregation;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;

import org.bson.conversions.Bson;
import org.entcore.common.aggregation.AggregationTools;
import org.entcore.common.aggregation.AggregationTools.HandlerChainer;
import org.entcore.common.aggregation.MongoConstants.COLLECTIONS;
import org.entcore.common.aggregation.filters.IndicatorFilter;
import org.entcore.common.aggregation.filters.mongo.DateFilter;
import org.entcore.common.aggregation.groups.IndicatorGroup;
import org.entcore.common.aggregation.indicators.Indicator;
import org.entcore.common.aggregation.indicators.mongo.IndicatorMongoImpl;
import org.entcore.common.aggregation.processing.AggregationProcessing;
import io.vertx.core.Handler;
import io.vertx.core.eventbus.Message;
import io.vertx.core.json.JsonObject;

import static org.entcore.common.aggregation.MongoConstants.*;
import fr.wseduc.mongodb.MongoDb;
import fr.wseduc.mongodb.MongoQueryBuilder;
import fr.wseduc.stats.aggregation.Indicators.UniqueVisitorIndicator;
import fr.wseduc.stats.aggregation.Indicators.StatsIndicatorMongoImpl;
import static com.mongodb.client.model.Filters.*;

/**
 * Daily traces aggregation routine for One.
 */
public class DailyAggregationProcessing extends AggregationProcessing{

	private final MongoDb mongo = MongoDb.getInstance();

	/**
	 * Cleanup if stats documents already exist.
	 * @param day : Day to clean up.
	 */
	public void cleanUp(Date day, final Handler<Void> next){
		Calendar calendarDay = Calendar.getInstance();
		calendarDay.setTime(day);
		Date lowerDay = AggregationTools.setToMidnight(calendarDay);
		calendarDay.add(Calendar.DATE, 1);
		Date higherDay = AggregationTools.setToMidnight(calendarDay);

		Bson statsFilter = and(gte(STATS_FIELD_DATE, MongoDb.formatDate(lowerDay)), lt(STATS_FIELD_DATE, MongoDb.formatDate(higherDay)));
		mongo.delete(COLLECTIONS.stats.name(), MongoQueryBuilder.build(statsFilter), new Handler<Message<JsonObject>>() {
			public void handle(Message<JsonObject> event) {
				next.handle(null);
			}
		});
	}

	private IndicatorMongoImpl createHourPeakIndicator(final Date day, int hour){
		IndicatorMongoImpl hourPeakIndicator = new StatsIndicatorMongoImpl(TRACE_TYPE_CONNEXION);
		Calendar calendarDay = Calendar.getInstance();
		calendarDay.setTime(day);
		final Date lowerHour = AggregationTools.setHourTo(calendarDay, hour);
		final Date higherHour = AggregationTools.setHourTo(calendarDay, hour+1);

		hourPeakIndicator.setWriteKey(TRACE_TYPE_CONNEXION+"_H"+hour);
		hourPeakIndicator.addFilter(new DateFilter(lowerHour, higherHour));

		return hourPeakIndicator;
	}

	private void addDayFilter(Indicator i, Date day){
		Calendar calendarDay = Calendar.getInstance();
		calendarDay.setTime(day);
		Date lowerDay = AggregationTools.setToMidnight(calendarDay);
		calendarDay.add(Calendar.DATE, 1);
		Date higherDay = AggregationTools.setToMidnight(calendarDay);

		IndicatorFilter dayFilter = new DateFilter(lowerDay, higherDay);

		i.addFilter(dayFilter);
	}

	private void addDefaultDayIndicators(Date day){
		ArrayList<IndicatorMongoImpl> dayIndicators = new ArrayList<>();

		/// SET INDICATORS HERE & ADD THEM TO THE ARRAY LIST

		//Connexions
		IndicatorMongoImpl connexionIndicator = new StatsIndicatorMongoImpl(TRACE_TYPE_CONNEXION);
		//Connexion hour peaks
		IndicatorMongoImpl[] hourPeakIndicators = new IndicatorMongoImpl[24];
		for(int i = 0; i < 24; i++){
			hourPeakIndicators[i] = createHourPeakIndicator(day, i);
		}

		//Account creation, deletion & activation
		IndicatorMongoImpl userCreationIndicator = new StatsIndicatorMongoImpl(TRACE_TYPE_CREATE_USER);
		IndicatorMongoImpl userDeletionIndicator = new StatsIndicatorMongoImpl(TRACE_TYPE_DELETE_USER);
		IndicatorMongoImpl userActivationIndicator = new StatsIndicatorMongoImpl(TRACE_TYPE_ACTIVATION);

		//Unique visitors
		IndicatorMongoImpl uniqueVisitorIndicator = new UniqueVisitorIndicator();
		uniqueVisitorIndicator.setWriteKey(uniqueVisitorIndicator.getWriteKey() + "_DAY");

		//Add to arraylist
		dayIndicators.add(connexionIndicator);
		dayIndicators.add(userCreationIndicator);
		dayIndicators.add(userDeletionIndicator);
		dayIndicators.add(userActivationIndicator);
		dayIndicators.add(uniqueVisitorIndicator);

		////////////////////////////////////////////////////

		//Add to every indicator a filter by day
		for(Indicator indicator: dayIndicators){
			addDayFilter(indicator, day);
			indicators.add(indicator);
		}

		//For hour peaks, skip adding the day filter
		for(IndicatorMongoImpl i : hourPeakIndicators){
			indicators.add(i);
		}
	}

	private void addDefaultWeekIndicators(Date day){
		Calendar calendarDay = Calendar.getInstance();
		calendarDay.setTime(day);
		calendarDay.add(Calendar.DATE, 1);
		Date higherDay = AggregationTools.setToMidnight(calendarDay);
		if(calendarDay.get(Calendar.DAY_OF_WEEK) < calendarDay.getFirstDayOfWeek())
			calendarDay.add(Calendar.WEEK_OF_YEAR, -1);
		calendarDay.set(Calendar.DAY_OF_WEEK, calendarDay.getFirstDayOfWeek());
		Date lowerDay = AggregationTools.setToMidnight(calendarDay);

		ArrayList<IndicatorMongoImpl> weekIndicators = new ArrayList<>();

		/// SET INDICATORS HERE & ADD THEM TO THE ARRAY LIST
		//Unique visitors
		IndicatorMongoImpl uniqueVisitorIndicator = new UniqueVisitorIndicator();
		uniqueVisitorIndicator.setWriteKey(uniqueVisitorIndicator.getWriteKey() + "_WEEK");

		//Add to arraylist
		weekIndicators.add(uniqueVisitorIndicator);

		////////////////////////////////////////////////////

		//Add to every indicator a filter to get traces from the first day of the week.
		IndicatorFilter weeklyFilter = new DateFilter(lowerDay, higherDay);

		for(Indicator indicator: weekIndicators){
			indicator.addFilter(weeklyFilter);
			indicators.add(indicator);
		}
	}

	private void addDefaultMonthlyIndicators(Date day){
		Calendar calendarDay = Calendar.getInstance();
		calendarDay.setTime(day);
		calendarDay.add(Calendar.DATE, 1);
		Date higherDay = AggregationTools.setToMidnight(calendarDay);
		calendarDay.add(Calendar.DATE, -1);
		calendarDay.set(Calendar.DATE, 1);
		Date lowerDay = AggregationTools.setToMidnight(calendarDay);

		ArrayList<IndicatorMongoImpl> monthlyIndicators = new ArrayList<>();

		/// SET INDICATORS HERE & ADD THEM TO THE ARRAY LIST

		//Unique visitors
		IndicatorMongoImpl uniqueVisitorIndicator = new UniqueVisitorIndicator();
		uniqueVisitorIndicator.setWriteKey(uniqueVisitorIndicator.getWriteKey() + "_MONTH");

		//Add to arraylist
		monthlyIndicators.add(uniqueVisitorIndicator);

		////////////////////////////////////////////////////

		//Add to every indicator a filter to get traces from first day of the month.
		IndicatorFilter monthlyFilter = new DateFilter(lowerDay, higherDay);

		for(Indicator indicator: monthlyIndicators){
			indicator.addFilter(monthlyFilter);
			indicators.add(indicator);
		}
	}

	private void addDefaultSeptemberIndicators(Date day){
		Calendar calendarDay = Calendar.getInstance();
		calendarDay.setTime(day);
		calendarDay.add(Calendar.DATE, 1);
		Date higherDay = AggregationTools.setToMidnight(calendarDay);

		int year = calendarDay.get(Calendar.YEAR);
		if(calendarDay.get(Calendar.MONTH) < 8)
			year--;

		calendarDay.set(year, 8, 1, 0, 0, 0);
		calendarDay.set(Calendar.MILLISECOND, 0);
		Date september = calendarDay.getTime();

		ArrayList<IndicatorMongoImpl> septemberIndicators = new ArrayList<>();

		/// SET INDICATORS HERE & ADD THEM TO THE ARRAY LIST

		////////////////////////////////////////////////////

		//Add to every indicator a filter to get traces from september 1
		IndicatorFilter septemberFilter = new DateFilter(september, higherDay);

		for(Indicator indicator: septemberIndicators){
			indicator.addFilter(septemberFilter);
			indicators.add(indicator);
		}
	}

	private HandlerChainer<Indicator, JsonObject> chainIndicators(){
		HandlerChainer<Indicator, JsonObject> chainer = new HandlerChainer<Indicator, JsonObject>(){
			protected void executeItem(Indicator indicator, Handler<JsonObject> nextCallback) {
				indicator.aggregate(nextCallback);
			}
		};

		for(Indicator indicator: indicators){
			chainer.chainItem(indicator);
		}

		return chainer;
	}

	/**
	 * Launch the aggregation routine for the current day with default indicators.
	 * @param callBack : Handler called when processing is over.
	 */
	@Override
	public void process(Handler<JsonObject> callBack){
		process(new Date(), callBack);
	}
	/**
	 * Launch the aggregation routine for a specific day with default indicators.
	 * @param day : Traces from that day will be processed.
	 * @param callBack : Handler called when processing is over.
	 */
	@Override
	public void process(final Date day, final Handler<JsonObject> callBack){
		//Clean up stats from the day if they already exist.
		cleanUp(day, new Handler<Void>() {
			public void handle(Void v) {
				//Sets recording date to midnight at "day" parameter time
				Calendar dayCalendar = Calendar.getInstance();
				dayCalendar.setTime(day);
				Date recordingDate = AggregationTools.setToMidnight(dayCalendar);

				//Adding default indicators
				addDefaultDayIndicators(day);
				addDefaultWeekIndicators(day);
				addDefaultMonthlyIndicators(day);
				addDefaultSeptemberIndicators(day);

				///// Default groups :
				//Profile
				IndicatorGroup profileGroup = new IndicatorGroup(TRACE_FIELD_PROFILE);
				//Structure + Structure/Profile + Structure/Classes + Structure/Classes/Profile
				IndicatorGroup structureGroup = new IndicatorGroup(TRACE_FIELD_STRUCTURES).setArray(true)
					.addChild(new IndicatorGroup(TRACE_FIELD_CLASSES).setArray(true).addChild(TRACE_FIELD_PROFILE))
					.addChild(new IndicatorGroup(TRACE_FIELD_PROFILE));

				//Adding groups
				for(Indicator indic : indicators){
					indic.addGroup(profileGroup)
						 .addGroup(structureGroup);
				}

				///// Special treatment for the service access Indicator : indicator has to be also grouped by module name :
				IndicatorMongoImpl serviceAccessIndicator = new StatsIndicatorMongoImpl(TRACE_TYPE_SVC_ACCESS);

				//Add day filter
				addDayFilter(serviceAccessIndicator, day);

				//Module
				IndicatorGroup moduleGroup = new IndicatorGroup(TRACE_FIELD_MODULE);
				//Profile/Module
				IndicatorGroup profileModuleGroup = new IndicatorGroup(TRACE_FIELD_PROFILE).addChild(TRACE_FIELD_MODULE);

				//Structure
				IndicatorGroup structGroup = new IndicatorGroup(TRACE_FIELD_STRUCTURES).setArray(true);
				//Structure/Module
				structGroup.addChild(TRACE_FIELD_MODULE)
				//Structure/Profil/Module
					.addAndReturnChild(TRACE_FIELD_PROFILE)
						.addChild(TRACE_FIELD_MODULE);
				//Structure/Class/Profile/Module
				IndicatorGroup classGroup = new IndicatorGroup(TRACE_FIELD_CLASSES).setArray(true);
				structGroup
					.addAndReturnChild(classGroup)
						.addChild(TRACE_FIELD_MODULE)
						.addAndReturnChild(TRACE_FIELD_PROFILE)
							.addChild(TRACE_FIELD_MODULE);

				serviceAccessIndicator
					.addGroup(moduleGroup)
					.addGroup(profileModuleGroup)
					.addGroup(structGroup);

				indicators.add(serviceAccessIndicator);

				////// Setting the recording time for all indicators
				for(Indicator i : indicators){
					i.setWriteDate(recordingDate);
				}

				////// Chaining Indicators and executing the process.
				chainIndicators().executeChain(callBack);
			}
		});
	}

	/**
	 * Process without default indicators.
	 * @param callBack : Handler called when processing is over.
	 */
	public void processBlank(Handler<JsonObject> callBack){
		// Chaining Indicators
		chainIndicators().executeChain(callBack);
	}

}
