import { idiom as lang } from "entcore";
import { cacheService } from "../../services/cache.service";
import { Dataset, datasetService } from "../../services/dataset.service";
import { Entity } from "../../services/entities.service";
import { statsApiService, StatsResponse } from "../../services/stats-api.service";
import { Indicator, IndicatorApi, IndicatorApiType, IndicatorChartType, IndicatorFrequency, IndicatorName, SCALES_CONFIG, TOOLTIPS_CONFIG } from "../abstractIndicator";

declare const Chart: any;

export abstract class AbstractBarIndicator extends Indicator {
    chartType: IndicatorChartType = 'bar';
    name: IndicatorName;
    api: IndicatorApi;
    apiType: IndicatorApiType;
    frequency: IndicatorFrequency;
    since: string;
    icon: string;
    chartTitle: string;
    chartFrequencies: IndicatorFrequency[];
    chartProfile: string;
    chartProfiles: string[];

    /**
	 * Builds and return a Bar Chart for Chart.js from indicator data/labels and entity
	 * @param ctx canvas context of chart.js dom element 
	 * @param entity 
	 */
	public async getChart(ctx: any, entity: Entity): Promise<typeof Chart> {
		let datasets: Array<Dataset> = [];
		let sortedLabels: Array<string> = [];
		// get chart data from API or cache
		let chartData = await this.getChartData(entity);
		
		if (chartData.constructor === Object && Object.keys(chartData).length > 0) {
			// get dataset for selected profile
			datasets = datasetService.getDatasetByProfile(this.chartProfile);
			// calculate Total dataset
			if (this.chartProfile === 'total') {
				let total = {};
				Object.keys(chartData).forEach(profileKey => {
					Object.keys(chartData[profileKey]).forEach(moduleKey => {
						if (!total[moduleKey]) {
							total[moduleKey] = [];
						}
						total[moduleKey].push(...chartData[profileKey][moduleKey]);
					})
				});
				chartData['total'] = total;
			}
			
			// sum data for each module for chartProfile
			let sumData = [];
			if (chartData[this.chartProfile]) {
				Object.keys(chartData[this.chartProfile]).forEach(moduleKey => {
					sumData.push(chartData[this.chartProfile][moduleKey].reduce((acc, x) => acc + x));
				});
			}
			datasets[0].data = sumData;
			
			// Chart labels
			let chartLabels: Array<string> = await this.getChartLabels(entity, chartData);
			
			// sorting		
			let labelAndDataArray: Array<{label: string, data: number}> = chartLabels.map((x, i) => {
				return {
					label: x,
					data: datasets[0].data[i] || 0,
				}
			});
			
			let sortedLabelAndDataArray = labelAndDataArray.sort((a, b) => b.data - a.data);
			let sortedData: Array<number> = [];
			sortedLabelAndDataArray.forEach(x => {
				sortedLabels.push(x.label);
				sortedData.push(x.data);
			});
			datasets[0].data = sortedData;
		}
		
		return new Chart(ctx, {
			type: this.chartType,
			data: {
				'labels': sortedLabels,
				datasets: datasets,
			},
			options: {
				tooltips: TOOLTIPS_CONFIG,
				legend: {
					display: false
				},
				scales: SCALES_CONFIG
			}
		});
	}

	async getChartLabels(entity: Entity, chartData): Promise<Array<string>> {
        let labels = [];

		Object.keys(chartData[this.chartProfile] || {}).forEach(moduleKey => {
			const moduleTranslated = lang.translate(moduleKey.toLowerCase());
			if (!labels.includes(moduleTranslated)) {
				labels.push(moduleTranslated);
			}
		})

        return labels;
	}

	async getChartData(entity: Entity): Promise<any> {
		const cachedIndicatorData = await cacheService.getIndicatorData(this, entity);
		return statsApiService.groupByKeys(cachedIndicatorData, 'profile', 'module', this.apiType);
	}

	initTotal(entity: Entity): void {
		const cachedIndicator = cacheService.getIndicatorFromEntityCache(this.name, this.frequency, entity);
		const dataGroupedByModuleAndProfile = statsApiService.groupByKeys(cachedIndicator.data, 'module', 'profile', this.apiType);
		
		let sumArray: Array<{module: string, total: number}> = [];
		Object.keys(dataGroupedByModuleAndProfile).forEach(module => {
			let sum = 0;
			Object.keys(dataGroupedByModuleAndProfile[module]).forEach(profile => {
				sum += dataGroupedByModuleAndProfile[module][profile].reduce((acc, x) => acc + x);
			});
			sumArray.push({module: module, total: sum});
		});
		
		let max = 0;
		sumArray.forEach(x => {
			if (x.total > max) {
				max = x.total;
			}
		});
		
		let moduleTotal = sumArray.find(x => x.total === max);
		let app = '';
		if (moduleTotal) {
			app = lang.translate(moduleTotal.module.toLowerCase());
		}
		// save value to Entity cache data
		cachedIndicator.totalValue = app;
	}

	abstract postInit(apiData: Array<StatsResponse>): void;
}