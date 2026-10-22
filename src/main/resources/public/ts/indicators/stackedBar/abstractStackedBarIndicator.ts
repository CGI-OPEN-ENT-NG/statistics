import { Dataset, datasetService } from "../../services/dataset.service";
import { Entity } from "../../services/entities.service";
import { StatsResponse } from "../../services/stats-api.service";
import { Indicator, IndicatorApi, IndicatorApiType, IndicatorChartType, IndicatorFrequency, IndicatorName, TOOLTIPS_CONFIG } from "../abstractIndicator";

declare const Chart: any;

export abstract class AbstractStackedBarIndicator extends Indicator {
    chartType: IndicatorChartType = 'stackedbar';
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

    async getChart(ctx: any, entity: Entity): Promise<typeof Chart> {
		let labels: Array<string> = [];
		let datasets: Array<Dataset> = [];
		let chartData = await this.getChartData(entity);
		
		if (chartData.constructor === Object && Object.keys(chartData).length > 0) {
			labels = await this.getChartLabels();
			datasets = datasetService.getAllProfilesDataset(Object.keys(chartData));
			// fill the chart datasets data array with the data just collected from API
			datasets.forEach(dataset => {
				if (chartData[dataset.key] && chartData[dataset.key].length > 0) {
					dataset.data = chartData[dataset.key];
				}
				delete dataset.key;
			});
		}
		
		return Promise.resolve(new Chart(ctx, {
			type: 'bar', // see options below for StackedBar configuration
			data: {
				'labels': labels,
				'datasets': datasets
			},
			options: {
				// StackedBar configuration
				scales: {
					xAxes: [{
						stacked: true
					}],
					yAxes: [{
						stacked: true,
						ticks: {
							beginAtZero: true,
							precision: 0
						}
					}]
				},
				tooltips: TOOLTIPS_CONFIG,
				legend: {
					display: true,
					position: 'bottom'
				}
			}
		}));
    }
    /**
     * Sum of the values of each profile by slot (hour of the day, day of the week): arrays of the same length, with 0
     * for the slots without data, so that the profiles can be stacked and summed slot by slot.
     */
    protected sumBySlot(data: Array<{profile?: string, date: string}>, slot: (date: Date) => number, slots: number): {[profile: string]: Array<number>} {
        const sums: {[profile: string]: Array<number>} = {};
        (data || []).forEach(d => {
            if (!sums[d.profile]) {
                sums[d.profile] = new Array(slots).fill(0);
            }
            sums[d.profile][slot(new Date(d.date))] += d[this.apiType] || 0;
        });
        return sums;
    }

    /**
     * Slot with the most values, all profiles together
     */
    protected peakSlot(sums: {[profile: string]: Array<number>}, slots: number): number {
        const total: Array<number> = new Array(slots).fill(0);
        Object.keys(sums).forEach(profile => sums[profile].forEach((value, i) => total[i] += value));
        return total.reduce((iMax, x, i, arr) => x > arr[iMax] ? i : iMax, 0);
    }

    abstract getChartLabels(): Array<string>;
    abstract getChartData(entity: Entity): Promise<any>;
	abstract initTotal(entity: Entity): void;
	abstract postInit(apiData: Array<StatsResponse>): void;
}