import { cacheService } from "../../services/cache.service";
import { Dataset, datasetService } from "../../services/dataset.service";
import { dateService } from "../../services/date.service";
import { Entity } from "../../services/entities.service";
import { statsApiService, StatsResponse } from "../../services/stats-api.service";
import { Indicator, IndicatorApi, IndicatorApiType, IndicatorChartType, IndicatorFrequency, IndicatorName, LEGEND_CONFIG, SCALES_CONFIG, TOOLTIPS_CONFIG } from "../abstractIndicator";

declare const Chart: any;

export abstract class AbstractLineIndicator extends Indicator {
    chartType: IndicatorChartType = 'line';
    name: IndicatorName;
    api: IndicatorApi;
    apiType: IndicatorApiType;
    frequency: IndicatorFrequency;
    since: string;
    icon: string;
    chartTitle: string;
    chartFrequencies: Array<IndicatorFrequency>;
    chartProfile: string;
    chartProfiles: Array<string>;

    /**
     * Generic Line Chart
     * @param ctx ChartJS context
     * @param entity current entity to retrieve associated cached data
     * @returns ChartJS instance
     */
    async getChart(ctx: any, entity: Entity): Promise<typeof Chart> {
		let chartLabels: Array<string> = [];
		let datasets: Array<Dataset> = [];
		
		// get data from cache if exists otherwise from API
		let apiData: Array<StatsResponse> = await cacheService.getIndicatorData(this, entity);
		
		if (apiData && apiData.length > 0) {
			// sort response data by date
			apiData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
			
			let chartDates: Array<Date> = this.getChartDates(apiData);
			chartLabels = this.getChartLabels(entity, chartDates);
			let chartData = await this.getChartData(entity, apiData, null);

			// for every dates in chart, fill the chartData with 0 value if no data for that date and replace null values by O
			chartDates.forEach((date, index) => {
				Object.values(chartData).forEach((profileData: Array<{date: Date, value: number}>) => {
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
			
			// total dataset		
			chartData['Total'] = [];
			chartDates.forEach((chartDate, index) => {
				let total = 0;
				Object.keys(chartData).forEach(profile => {
					if (profile !== 'Total') {
						const items = chartData[profile].filter(d => dateService.isInSameRange(d.date, chartDate, this.frequency));
						if (items) {
							total += items.reduce((acc, x) => acc.value + x.value, {value: 0});
						}
					}
				});
				chartData['Total'][index] = {date: chartDate, value: total};
			});
			
			// fill the chart datasets data array with data values
			datasets = datasetService.getAllProfilesWithTotalDataset(Object.keys(chartData).filter(profile => profile !== 'Total'));
			datasets.forEach(dataset => {
				if (chartData[dataset.key] && chartData[dataset.key].length > 0) {
					dataset.data = chartData[dataset.key].map(x => x.value);
				}
				delete dataset.key;
			});
		}
		
		return new Chart(ctx, {
			type: this.chartType,
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

	getChartDates(apiData: Array<StatsResponse>): Array<Date> {
		return dateService.getDates(
			dateService.getMinDateFromData(apiData), 
			dateService.getMaxDateFromData(apiData), 
			this.frequency);
	}

	getChartData(entity: Entity, apiData: Array<StatsResponse>, specificApiType: IndicatorApiType): any { // FIXME Return Type
		if (!specificApiType) {
			return statsApiService.groupByKeyWithDate(apiData, 'profile', this.apiType);
		}
		return statsApiService.groupByKeyWithDate(apiData, 'profile', specificApiType);
	}

	getChartLabels(entity: Entity, chartDates: Array<Date>): Array<string> {
		switch (this.frequency) {
			case 'month':
				return dateService.getMonthLabels(chartDates);
			case 'week':
				return dateService.getWeekLabels(chartDates);
			case 'day':
				return dateService.getDayLabels(chartDates);
			default:
				return [];
		}
	}

	initTotal(entity: Entity): void {
		let totalValue = 0;
		const cachedIndicator = cacheService.getIndicatorFromEntityCache(this.name, this.frequency, entity);
		if (cachedIndicator && cachedIndicator.data) {
			cachedIndicator.data.forEach(d => {
				totalValue += d[this.apiType];
			});
		}
		cachedIndicator.totalValue = totalValue;
	}

	abstract postInit(apiData: Array<StatsResponse>): void;
}