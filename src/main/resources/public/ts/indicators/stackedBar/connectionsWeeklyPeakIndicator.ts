import { idiom as lang } from "entcore";
import { cacheService } from "../../services/cache.service";
import { Entity } from "../../services/entities.service";
import { StatsAccountsResponse, StatsResponse } from "../../services/stats-api.service";
import { IndicatorApi, IndicatorApiType, IndicatorFrequency, IndicatorName } from "../abstractIndicator";
import { AbstractStackedBarIndicator } from "./abstractStackedBarIndicator";

export class ConnectionsWeeklyPeakIndicator extends AbstractStackedBarIndicator {
    name: IndicatorName = 'stats.weeklyPeak';
    since = '';
    icon = 'calendar-button';
    api: IndicatorApi = 'accounts';
    apiType: IndicatorApiType = 'authentications';
    chartTitle = lang.translate('stats.labels.weeklyPeak');
    frequency: IndicatorFrequency = 'day';

    private static readonly INSTANCE = new ConnectionsWeeklyPeakIndicator();

    private constructor() {
        super();
    }

    public static getInstance() {
        return ConnectionsWeeklyPeakIndicator.INSTANCE;
    }

    getChartLabels(): Array<string> {
        var labels: Array<string> = [];
        labels.push(lang.translate("stats.monday"));
        labels.push(lang.translate("stats.tuesday"));
        labels.push(lang.translate("stats.wednesday"));
        labels.push(lang.translate("stats.thursday"));
        labels.push(lang.translate("stats.friday"));
        labels.push(lang.translate("stats.saturday"));
        labels.push(lang.translate("stats.sunday"));
        return labels;
	}
	
	async getChartData(entity: Entity): Promise<any> {
        const data: StatsAccountsResponse[] = await cacheService.getIndicatorData(this, entity) as StatsAccountsResponse[];
        // {profile: [sum Monday, ..., sum Sunday]}
        return this.sumBySlot(data, date => (date.getDay() + 6) % 7, 7);
    }

    async initTotal(entity: Entity): Promise<void> {
		const connectionsWeeklyPeakIndicator = cacheService.getIndicatorFromEntityCache(this.name, this.frequency, entity);
		const apiData: Array<StatsResponse> = await cacheService.getData(this.api, this.frequency, entity.level, entity.id, false);
		if (!apiData || apiData.length === 0) {
			connectionsWeeklyPeakIndicator.totalValue = '-';
			return;
		}
		const daysMatch = ['stats.monday', 'stats.tuesday', 'stats.wednesday', 'stats.thursday', 'stats.friday',
			'stats.saturday', 'stats.sunday'];
		// save value to Entity cache data
		connectionsWeeklyPeakIndicator.totalValue = lang.translate(daysMatch[this.peakSlot(this.sumBySlot(apiData, date => (date.getDay() + 6) % 7, 7), 7)]);
    }

    /**
     * Overwrite getTotal for total value in indicator card
     * @param entity 
     * @returns 
     */
    getTotal(entity: Entity): number | string {
        let cachedIndicator = null;
        cachedIndicator = cacheService.getIndicatorFromEntityCache(this.name, 'day', entity);
        if (cachedIndicator) {
            return cachedIndicator.totalValue;
        }
        return 0;
    }

    isDataExportable(): boolean {
        return false;
    }

    showProfileFilter(): boolean {
        return false;
    }

    postInit(apiData: Array<StatsResponse>): void {

    }
}