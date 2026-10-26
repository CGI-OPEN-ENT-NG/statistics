import { AppService } from "../../services/app.service";
import { cacheService } from "../../services/cache.service";
import { Entity } from "../../services/entities.service";
import { StatsResponse } from "../../services/stats-api.service";
import { IndicatorApi, IndicatorApiType, IndicatorName, IndicatorFrequency } from "../abstractIndicator";
import { AbstractBarIndicator } from "./abstractBarIndicator";

export class MostUsedConnectorsIndicator extends AbstractBarIndicator {
    name: IndicatorName = 'stats.mostUsedConnector';
    since = "";
    icon = 'connector-icon';
    api: IndicatorApi = 'access';
    apiType: IndicatorApiType = 'access';
    chartTitle = 'stats.labels.mostUsedConnectors';
    chartProfile = 'total';
    chartProfiles = ['total', 'Teacher', 'Personnel', 'Relative', 'Student', 'Guest'];
    frequency: IndicatorFrequency = 'month';
    // apps combo select
    appNames: Array<{key: string, value: string}>;
    exportFrequency: IndicatorFrequency = 'month'; // temporary fix (exported data by day are different than graph data)

    private static readonly INSTANCE = new MostUsedConnectorsIndicator();

    private constructor() {
        super();
    }

    public static getInstance() {
        return MostUsedConnectorsIndicator.INSTANCE;
    }

    async getApiData(entity: Entity): Promise<Array<StatsResponse>> {
        let apiData: Array<StatsResponse> = await cacheService.getData(this.api, 'month', entity.level, entity.id, false);
        apiData = apiData.filter(data => data['type'] === 'CONNECTOR' && data['module'] !== 'library');
        return apiData;
    }

    isDataExportable(): boolean {
        return true;
    }

    showProfileFilter(): boolean {
        return true;
    }

    postInit(apiData: Array<StatsResponse>): void {
        // initialize apps list for apps combo select
        this.appNames = AppService.getInstance().getAppNames(apiData);
    }
}