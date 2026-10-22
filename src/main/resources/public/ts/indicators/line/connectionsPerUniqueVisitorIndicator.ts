import { cacheService } from "../../services/cache.service";
import { Dataset, datasetService } from "../../services/dataset.service";
import { dateService } from "../../services/date.service";
import { Entity } from "../../services/entities.service";
import { StatsAccountsResponse, statsApiService, StatsResponse } from "../../services/stats-api.service";
import { IndicatorApi, IndicatorApiType, IndicatorFrequency, IndicatorName, LEGEND_CONFIG, SCALES_CONFIG, TOOLTIPS_CONFIG } from "../abstractIndicator";
import { AbstractLineIndicator } from "./abstractLineIndicator";
import { ConnectionsIndicator } from "./connectionsIndicator";
import { UniqueVisitorsIndicator } from "./uniqueVisitorsIndicator";

declare const Chart: any;

export class ConnectionsPerUniqueVisitorIndicator extends AbstractLineIndicator {
    name: IndicatorName = 'stats.connectionsByUniqueVisitors';
    since = 'stats.firstDayOfMonth';
    icon = 'connection-by-visitors-icon';
    api: IndicatorApi = 'accounts';
    apiType: IndicatorApiType = 'mixed';
    chartTitle = 'stats.labels.connectionsByUniqueVisitors';
    chartFrequencies: Array<IndicatorFrequency> = ['day', 'week', 'month'];
    frequency: IndicatorFrequency = 'month';
    
    private static readonly INSTANCE = new ConnectionsPerUniqueVisitorIndicator();

    private constructor() {
        super();
    }

    public static getInstance() {
        return ConnectionsPerUniqueVisitorIndicator.INSTANCE;
    }

    /**
	 * Specific Line chart because of Connections per UniqueVisitors calculation
	 * @param ctx canvas context of chart.js dom element
	 * @param indicator 
	 * @param entity 
	 */
     public async getChart(ctx: any, entity: Entity): Promise<typeof Chart> {
		let chartLabels: Array<string> = [];
		let datasets: Array<Dataset> = [];
		
		// get connections data from cache if exists otherwise from API
        const connectionsIndicator = ConnectionsIndicator.getInstance();
		connectionsIndicator.frequency = this.frequency;
		let apiData: Array<StatsResponse> = await cacheService.getIndicatorData(connectionsIndicator, entity);
		
		if (apiData && apiData.length > 0) {
			// sort response data by date
			apiData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
			
			// chart dates and labels
			let chartDates: Array<Date> = super.getChartDates(apiData);
			chartLabels = this.getChartLabels(entity, chartDates);
			
			// connections data
			let connectionsData = statsApiService.groupByKeyWithDate(apiData, 'profile', connectionsIndicator.apiType);
			// for every dates in chart, fill the chartData with 0 value if no data for that date and replace null values by O
			chartDates.forEach((date, index) => {
				Object.values(connectionsData).forEach((profileData: Array<{date: Date, value: number}>) => {
					if (!profileData.find(x => dateService.isInSameRange(date, x.date, this.frequency))) {
						profileData.splice(index, 0, {date: date, value: 0});
					}
					profileData.forEach((data, index) => {
						if (data.value === null) {
							profileData.splice(index, 1, {date: data.date, value: 0});
						}
					});
				});
			});
			
			// unique visitors data
            const uniqueVisitorsIndicator = UniqueVisitorsIndicator.getInstance();
			let uniqueVisitorsData = statsApiService.groupByKeyWithDate(apiData, 'profile', uniqueVisitorsIndicator.apiType);
			// for every dates in chart, fill the chartData with 0 value if no data for that date and replace null values by O
			chartDates.forEach((date, index) => {
				Object.values(uniqueVisitorsData).forEach((profileData: Array<{date: Date, value: number}>) => {
					if (!profileData.find(x => dateService.isInSameRange(date, x.date, this.frequency))) {
						profileData.splice(index, 0, {date: date, value: 0});
					}
					profileData.forEach((data, index) => {
						if (data.value === null) {
							profileData.splice(index, 1, {date: data.date, value: 0});
						}
					});
				});
			});
			
			// Divide connectionsChartData with uniqueVisitorsChartData to obtain final chart data
			let chartData = {};
			Object.keys(connectionsData).forEach(key => {
				let divisionArray = connectionsData[key].map((connectionsDateAndValue: {date: Date, value: number}, i) => {
					if (!connectionsDateAndValue.value || isNaN(connectionsDateAndValue.value)) {
						return {date: connectionsDateAndValue.date, value: 0};
					}
					
					let uniqueVisitorsDateAndValue: {date: Date, value: number} = uniqueVisitorsData[key][i];
					if (!uniqueVisitorsDateAndValue.value || isNaN(uniqueVisitorsDateAndValue.value)) {
						return {date: uniqueVisitorsDateAndValue.date, value: 0};
					}
					return {date: connectionsDateAndValue.date, value: Math.round((connectionsDateAndValue.value / uniqueVisitorsDateAndValue.value) * 100) / 100};
				});
				chartData[key] = divisionArray;
			});
			
			// average dataset
			let nbProfileMax = Math.max(Object.keys(connectionsData).length, Object.keys(uniqueVisitorsData).length);
			chartData['Average'] = [];
			chartDates.forEach((chartDate, index) => {
				let total = 0;
				Object.keys(chartData).forEach(profile => {
					if (profile !== 'Average') {					
						const items = chartData[profile].filter(d => dateService.isInSameRange(d.date, chartDate, this.frequency));
						if (items) {
							total += items.reduce((acc, x) => acc.value + x.value, {value: 0});;
						}
					}
				});
				let average = total / nbProfileMax;
				chartData['Average'][index] = {date: chartDate, value: Math.round(average * 100) / 100};
			});
			
			// fill the chart datasets data array with data values
			datasets = datasetService.getAllProfilesWithAverageDataset(Object.keys(chartData).filter(profile => profile !== 'Average'));
			datasets.forEach(dataset => {
				if (chartData[dataset.key] && chartData[dataset.key].length > 0) {
					dataset.data = chartData[dataset.key].map(x => x.value);
				}
				delete dataset.key;
			});
		}
		
		return new Chart(ctx, {
			type: 'line',
			data: {
				'labels': chartLabels,
				'datasets': datasets
			},
			options: {
				tooltips: TOOLTIPS_CONFIG,
				legend: LEGEND_CONFIG,
				scales: SCALES_CONFIG
			}
		});
	}

	initTotal(entity: Entity) {
		let currentDate = new Date();
		
		let authenticationsTotalValue = 0;
		const authenticationsCacheIndicator = cacheService.getIndicatorFromEntityCache('stats.connections', this.frequency, entity);
		authenticationsCacheIndicator.data.forEach((d: StatsAccountsResponse) => {
			if (dateService.isSameMonth(currentDate, new Date(d.date))) {
				authenticationsTotalValue += d.authentications;
			}
		});
		
		let uniqueVisitorsTotalValue = 0;
		const uniqueVisitorsCacheIndicator = cacheService.getIndicatorFromEntityCache('stats.uniqueVisitors', this.frequency, entity);
		uniqueVisitorsCacheIndicator.data.forEach((d: StatsAccountsResponse) => {
			if (dateService.isSameMonth(currentDate, new Date(d.date))) {
				uniqueVisitorsTotalValue += d.unique_visitors;
			}
		});
		
		const cachedIndicator = cacheService.getIndicatorFromEntityCache(this.name, this.frequency, entity);;
		if (uniqueVisitorsTotalValue > 0) {
			cachedIndicator.totalValue = Math.round(authenticationsTotalValue / uniqueVisitorsTotalValue);
		} else {
			cachedIndicator.totalValue = 0;
		}
	}

	isDataExportable(): boolean {
        return true;
    }

	showProfileFilter(): boolean {
        return false;
    }

	postInit(apiData: Array<StatsResponse>): void {

    }
}
