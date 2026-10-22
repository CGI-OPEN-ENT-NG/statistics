import { idiom as lang } from "entcore";
import { cacheService } from "../../services/cache.service";
import { Entity } from "../../services/entities.service";
import { StatsAccountsResponse, StatsResponse } from "../../services/stats-api.service";
import { IndicatorApi, IndicatorApiType, IndicatorFrequency, IndicatorName } from "../abstractIndicator";
import { AbstractStackedBarIndicator } from "./abstractStackedBarIndicator";

export class ConnectionsDailyPeakIndicator extends AbstractStackedBarIndicator {
    name: IndicatorName = 'stats.dailyPeak';
    since = '';
    api: IndicatorApi = 'accounts';
    apiType: IndicatorApiType = 'authentications';
    icon = 'clock-icon';
    chartTitle = lang.translate('stats.labels.dailyPeak');
    frequency: IndicatorFrequency = 'hour';

    private static readonly INSTANCE = new ConnectionsDailyPeakIndicator();

    private constructor() {
        super();
    }

    public static getInstance() {
        return ConnectionsDailyPeakIndicator.INSTANCE;
    }

    getChartLabels(): Array<string> {
        let labels: Array<string> = [];
        for(let i = 0; i < 24; i++){
            let hour1 = ("0"+i).slice(-2)
            let hour2 = ("0"+(i+1)).slice(-2)
            labels.push(hour1+'h-'+hour2+'h')
        }
        return labels;
	}
	
	async getChartData(entity: Entity): Promise<any> {
        const data: StatsAccountsResponse[] = await cacheService.getIndicatorData(this, entity) as StatsAccountsResponse[];
        // {profile: [sum 0h-1h, sum 1h-2h, ..., sum 23h-24h]}
        return this.sumBySlot(data, date => date.getHours(), 24);
	}

    async initTotal(entity: Entity): Promise<void> {
		const connectionsDailyPeakIndicator = cacheService.getIndicatorFromEntityCache(this.name, this.frequency, entity);
		const accountsData: Array<StatsResponse> = await cacheService.getData(this.api, this.frequency, entity.level, entity.id, false);
		if (!accountsData || accountsData.length === 0) {
			connectionsDailyPeakIndicator.totalValue = '-';
			return;
		}
		// save value to Entity cache data
		connectionsDailyPeakIndicator.totalValue = this.peakSlot(this.sumBySlot(accountsData, date => date.getHours(), 24), 24) + 'h';
    }

    /**
     * Overwrite getTotal for total value in indicator card
     * @param entity 
     * @returns 
     */
    getTotal(entity: Entity): number | string {
        let cachedIndicator = null;
        cachedIndicator = cacheService.getIndicatorFromEntityCache(this.name, 'hour', entity);
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