import { idiom as lang } from "entcore";
import { cacheService } from "../../services/cache.service";
import { Dataset } from "../../services/dataset.service";
import { dateService } from "../../services/date.service";
import { Entity } from "../../services/entities.service";
import { StatsResponse } from "../../services/stats-api.service";
import { IndicatorApi, IndicatorApiType, IndicatorFrequency, IndicatorName, LEGEND_CONFIG, SCALES_CONFIG, TOOLTIPS_CONFIG } from "../abstractIndicator";
import { AbstractLineIndicator } from "./abstractLineIndicator";

declare const Chart: any;

export class ActivationAndLoadedIndicator extends AbstractLineIndicator {
    name: IndicatorName = 'stats.activatedAccounts';
    since = '';
    icon = 'people-icon';
    api: IndicatorApi = 'accounts';
    apiType: IndicatorApiType = 'activated';
    chartTitle = 'stats.labels.activatedAccounts';
    chartFrequencies: Array<IndicatorFrequency> = ['day', 'week', 'month'];
    chartProfile = 'total';
    chartProfiles = ['total', 'Teacher', 'Personnel', 'Relative', 'Student', 'Guest'];
    frequency: IndicatorFrequency = 'month';

    private static readonly INSTANCE = new ActivationAndLoadedIndicator();

    private constructor() {
        super();
    }

    public static getInstance() {
        return ActivationAndLoadedIndicator.INSTANCE;
    }

    /**
	 * Specific chart calculations
	 * @param ctx canvas context of chart.js dom element
	 * @param entity 
	 */
    async getChart(ctx: any, entity: Entity): Promise<typeof Chart> {
		let chartLabels: Array<string> = [];
		let datasets: Array<Dataset> = [];
		
		// get api data to get activated and loaded data
		let apiData: Array<StatsResponse> = await cacheService.getData(
			'accounts',
			this.frequency,
			entity.level,
			entity.id,
			false
		);
		
		if (apiData && apiData.length > 0) {
			// sort response data by date
			apiData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
			
			// chart labels
			let chartDates: Array<Date> = super.getChartDates(apiData);
			chartLabels = super.getChartLabels(entity, chartDates);

			// activated chart data
			let activatedChartData = this.getChartData(entity, apiData, 'activated');
			// for every dates in chart, fill the chartData with null value if no data for that date
			chartDates.forEach((date, index) => {
				Object.values(activatedChartData).forEach((profileData: Array<{date: Date, value: number}>) => {
					if (!profileData.find(x => dateService.isInSameRange(date, x.date, this.frequency))) {
						profileData.splice(index, 0, {date: date, value: null});
					}
				});
			});
			
			// loaded chart data
			let loadedChartData = this.getChartData(entity, apiData, 'loaded');
			// for every dates in chart, fill the chartData with null value if no data for that date
			chartDates.forEach((date, index) => {
				Object.values(loadedChartData).forEach((profileData: Array<{date: Date, value: number}>) => {
					if (!profileData.find(x => dateService.isInSameRange(date, x.date, this.frequency))) {
						profileData.splice(index, 0, {date: date, value: null});
					}
				});
			});
			
			// Total dataset calculation:
			activatedChartData['total'] = [];
			loadedChartData['total'] = [];
			chartDates.forEach((chartDate, index) => {
				// Handling null values:
				// if all data are null for a date range then total is null,
				// and we let the chartjs spanGaps option to handle gap display in line chart
				let activatedAllNullValues: boolean = true;
				let loadedAllNullValues: boolean = true;
				
				Object
					.keys(activatedChartData)
					.filter((profile: string) => profile !== 'total')
					.forEach((profile: string) => {
						activatedChartData[profile]
							.filter((data: {date: Date, value: number}) => 
								dateService.isInSameRange(data.date, chartDate, this.frequency))
							.forEach((data: {date: Date, value: number}) => {
								if (data.value !== null) {
									activatedAllNullValues = false;
								}
							});
					});
				
				Object
					.keys(loadedChartData)
					.filter((profile: string) => profile !== 'total')
					.forEach((profile: string) => {
						loadedChartData[profile]
							.filter((data: {date: Date, value: number}) => 
								dateService.isInSameRange(data.date, chartDate, this.frequency))
							.forEach((data: {date: Date, value: number}) => {
								if (data.value !== null) {
									loadedAllNullValues = false;
								}
							})
					});
				
				// total activated calculation
				let totalActivated = 0;
				if (activatedAllNullValues) {
					totalActivated = null;
				} else {
					Object
						.keys(activatedChartData)
						.filter((profile: string) => profile !== 'total')
						.forEach((profile: string) => {
							const activatedItems = activatedChartData[profile].filter((data: {date: Date, value: number}) => 
								dateService.isInSameRange(data.date, chartDate, this.frequency));
							if (activatedItems && activatedItems.length > 0) {
								totalActivated += activatedItems.reduce((acc, x) => acc.value + x.value, {value: 0});
							}
						});
				}
				
				// total loaded calculation
				let totalLoaded = 0;
				if (loadedAllNullValues) {
					totalLoaded = null;
				} else {
					Object
						.keys(loadedChartData)
						.filter((profile: string) => profile !== 'total')
						.forEach((profile: string) => {	
							const loadedItems = loadedChartData[profile].filter((data: {date: Date, value: number}) => 
								dateService.isInSameRange(data.date, chartDate, this.frequency));
							if (loadedItems && loadedItems.length > 0) {
								totalLoaded += loadedItems.reduce((acc, x) => acc.value + x.value, {value: 0});
							}
					});
				}
				
				activatedChartData['total'][index] = {date: chartDate, value: totalActivated};
				loadedChartData['total'][index] = {date: chartDate, value: totalLoaded};
			});

			let activationDatasetValues = [];
			if (activatedChartData[this.chartProfile]) {
				activationDatasetValues = activatedChartData[this.chartProfile].map(x => x.value);
			}
			datasets.push({
				label: lang.translate('stats.activatedAccounts.legend'),
				backgroundColor: 'rgba(255, 141, 46, 0.75)',
				borderWidth: 1,
				fill: 'origin',
				lineTension: 0,
				spanGaps: true,
				data: activationDatasetValues
			});
			
			let loadedDatasetValues = [];
			if (loadedChartData[this.chartProfile]) {
				loadedDatasetValues = loadedChartData[this.chartProfile].map(x => x.value);
			}
			datasets.push({
				label: lang.translate('stats.loaded.legend'),
				backgroundColor: 'rgba(140, 147, 158, 0.75)',
				borderWidth: 1,
				fill: 'origin',
				lineTension: 0,
				spanGaps: true,
				data: loadedDatasetValues
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

	initTotal(entity: Entity) {
		let totalValue = 0;
		const cachedIndicator = cacheService.getIndicatorFromEntityCache(this.name, this.frequency, entity);
		if (cachedIndicator && cachedIndicator.data) {
			// activated metric is cumulated so we need to get last value for each profile
			['Student', 'Relative', 'Teacher', 'Personnel', 'Guest'].forEach(profile => {
				const dataFilteredByProfile = cachedIndicator.data.filter(d => d.profile === profile);
				if (dataFilteredByProfile && dataFilteredByProfile.length > 0) {
					dataFilteredByProfile
						.filter(d => new Date(d.date).getTime() === dateService.getMaxDateFromData(dataFilteredByProfile).getTime())
						.forEach(x => totalValue += x['activated']);
				}
			});
		}
		cachedIndicator.totalValue = totalValue;
	}

	isDataExportable(): boolean {
        return true;
    }

	showProfileFilter(): boolean {
        return true;
    }

	postInit(apiData: Array<StatsResponse>): void {

    }
}