import { idiom as lang } from "entcore";
import { cacheService } from "../../services/cache.service";
import { Dataset, datasetService } from "../../services/dataset.service";
import { dateService } from "../../services/date.service";
import { Entity } from "../../services/entities.service";
import { statsApiService, StatsResponse } from "../../services/stats-api.service";
import { IndicatorApi, IndicatorApiType, IndicatorFrequency, IndicatorName, LEGEND_CONFIG, SCALES_CONFIG, TOOLTIPS_CONFIG } from "../abstractIndicator";
import { AbstractLineIndicator } from "./abstractLineIndicator";

declare const Chart: any;

export class DevicesIndicator extends AbstractLineIndicator {
    name: IndicatorName = 'stats.devices';
    since = '';
    icon = 'devices-icon';
    api: IndicatorApi = 'accounts';
    apiType: IndicatorApiType = 'mixed';
    chartTitle = "stats.labels.devices";
    chartFrequencies: Array<IndicatorFrequency> = ['day', 'week', 'month'];
    chartProfile = 'total';
    chartProfiles = ['total', 'Teacher', 'Personnel', 'Relative', 'Student', 'Guest'];
    frequency: IndicatorFrequency = 'month';
    
    private static readonly INSTANCE = new DevicesIndicator();

    private constructor() {
        super();
    }

    public static getInstance() {
        return DevicesIndicator.INSTANCE;
    }

	/**
	 * Specific call for device
	 * @param entity 
	 * @returns stats data with device true
	 */
	async getApiData(entity: Entity): Promise<Array<StatsResponse>> {
        let apiData: Array<StatsResponse> = await cacheService.getData(this.api, 'month', entity.level, entity.id, true);
        return apiData;
    }

    /**
	 * Specific chart for devices
	 * @param ctx canvas context of chart.js dom element
	 * @param entity current entity (to retrieve associated data)
	 */
	async getChart(ctx: any, entity: Entity): Promise<typeof Chart> {
		let chartLabels: Array<string> = [];
		let datasets: Array<Dataset> = [];
		
		// get data from cache if exists otherwise get data from API
		let apiData: Array<StatsResponse> = await cacheService.getIndicatorData(this, entity);
		// filter by selected profile in graph
		if (this.chartProfile !== 'total') {
			apiData = apiData.filter(d => d.profile === this.chartProfile);
		}
		
		if (apiData && apiData.length > 0) {
			// sort response data by date
			apiData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
			
			// chart labels
			let chartDates: Array<Date> = super.getChartDates(apiData);
			chartLabels = super.getChartLabels(entity, chartDates);
			
			// chart data grouped by device
			let chartData = statsApiService.groupByKeyWithDate(apiData, 'device_type', 'authentications');
			// for every dates in chart, fill the chartData with 0 value if no data for that date and replace null values by O
			chartDates.forEach((date, index) => {
				Object.values(chartData).forEach((deviceData: Array<{date: Date, value: number}>) => {
					if (!deviceData.find(x => dateService.isInSameRange(date, x.date, this.frequency))) {
						deviceData.splice(index, 0, {date: date, value: 0});
					}
					deviceData.forEach((data, index) => {
						if (data.value === null) {
							deviceData.splice(index, 1, {date: data.date, value: 0});
						}
					});
				});
			});

			// sum values if multiple values for same date
			Object.keys(chartData).forEach(deviceData => {
				chartData[deviceData] = chartData[deviceData].reduce((acc: Array<{date: Date, value: number}>, obj) => {
					let found = false;
					acc.forEach((accItem, index) => {
						if (accItem.date.getTime() === obj.date.getTime()) {
							found = true;
							acc[index].value += obj.value;
						}
					});
					if (!found) {
						acc.push(obj);
					}
					return acc;
				}, []);
			});

			// fill the chart datasets data array with chartData values
			datasets = datasetService.getDevicesDataset();
			datasets.forEach(dataset => {
				if (chartData[dataset.key] && chartData[dataset.key].length > 0) {
					dataset.data = chartData[dataset.key].map(x => x.value);
				} else {
					// if no data for a specific device,
					// fill the corresponding dataset data with 0 value for each date of the chart
					chartDates.forEach(() => dataset.data.push(0));
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

	initTotal(entity: Entity): void {
		const cachedIndicator = cacheService.getIndicatorFromEntityCache(this.name, this.frequency, entity);
		const dataGroupedByDevice = statsApiService.groupByKeyWithDate(cachedIndicator.data, 'device_type', 'authentications');
		
		let devicesTotal: Array<{device: string, total: number}> = [];
		Object.keys(dataGroupedByDevice).forEach(device => {
			let total = 0;
			total += dataGroupedByDevice[device].reduce((acc, value) => acc + value.value, 0);
			devicesTotal.push({device, total});
		});
		
		let max = 0;
		devicesTotal.forEach(deviceTotal => {
			if (deviceTotal.total > max) {
				max = deviceTotal.total;
			}
		});
		
		const deviceTotal = devicesTotal.find(deviceTotal => deviceTotal.total === max);
		if (deviceTotal) {
			cachedIndicator.totalValue = lang.translate(`stats.device.${deviceTotal.device}`);
		} 
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