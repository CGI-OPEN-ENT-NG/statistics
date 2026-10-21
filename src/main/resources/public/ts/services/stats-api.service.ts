import http from 'axios';
import { IndicatorApi, IndicatorApiType, IndicatorFrequency } from '../indicators/abstractIndicator';
import { EntityLevel } from './entities.service';

export interface StatsCommonResponse {
    id: string;
    platform_id: string;
    date: string;
    structure_id?: string;
    class_id?: string;
    profile: string;
}

export interface StatsAccountsResponse extends StatsCommonResponse {
    loaded: number;
    activated: number;
    authentications: number;
    unique_visitors: number;
    activations: number;
    sessions: number;
    device_type: string;
};

export interface StatsAccessResponse extends StatsCommonResponse {
    type: string;
    module: string;
    access: number;
    unique_access_minute: number;
    unique_access: number;
}

export type StatsResponse = StatsAccountsResponse & StatsAccessResponse;

export class StatsApiService {
    
    /**
     * API Call for Accounts stats with query string
     * @param api indicator api (accounts, access)
     * @param from from date
     * @param frequency day or week or month
     * @param entitylevel structure or class
     * @param entities ids of structure or class
     * @param device boolean get device data or not
     * @param to to date (empty: up to now)
     */
    async getStats(api: IndicatorApi, from: string, frequency: IndicatorFrequency, entitylevel: EntityLevel, entities: Array<string>, device: boolean, to?: string): Promise<Array<StatsResponse>> {
        let queryString = `?indicator=${api}&from=${from}&frequency=${frequency}&entityLevel=${entitylevel}`;
        if (to) {
            queryString += `&to=${to}`;
        }
        let entitiesString = '';
        if (entities) {
            entities.forEach(entity => {
                entitiesString = `${entitiesString}&entity=${entity}`;
            });
        }
        queryString = queryString + entitiesString;
        if (device) {
            queryString += `&device=${device}`;
        }
        let res = await http.get(`/stats/list${queryString}`);
        return res.data;
    }
    
    /**
     * 
     * @param data input data (api stats data)
     * @param key1 first api attribute to groupBy
     * @param key2 second api attribute to groupBy
     * @param value api attribute to get values from
     * @returns object, example:
     * {
     *      key1: {
     *          key2: [values, ...]
     *      } 
     * }
     */
    public groupByKeys(data: Array<StatsResponse>, key1: string, key2: string, value: IndicatorApiType) {
        return data.reduce((acc, x) => {
            if (!acc[x[key1]]) {
                acc[x[key1]] = {};
            }
            (acc[x[key1]][x[key2]] = acc[x[key1]][x[key2]] || []).push(x[value]);
            return acc;
        }, {});
    }

    public groupByKeysWithDate(data: Array<StatsResponse>, key1: string, key2: string, value: IndicatorApiType) {
        return data.reduce((acc, x) => {
            if (!acc[x[key1]]) {
                acc[x[key1]] = {};
            }
            (acc[x[key1]][x[key2]] = acc[x[key1]][x[key2]] || []).push({date: new Date(x.date), value: x[value]});
            return acc;
        }, {});
    }
    
    /**
     * @param data input data (api stats data)
     * @param key api attribute to groupBy
     * @param value api attribute to get values from
     * @returns object with key as keys and array of {date: Date, value: number} as values
     * 
     * Usage: statsApiService.groupByKeyValuesWithDate(apiData, 'device_type', 'authentications')
     * This will group data by key 'device_type' for 'authentications' values with date.
     * This will return: 
     * {
     *      desktop: [{date: '01/01/2020', value: 30}, ...], 
     *      mobile: [{date: '01/01/2020', value: 20}, ...]
     * }
     */
    public groupByKeyWithDate(data: Array<StatsResponse>, key: string, value: IndicatorApiType) {
        return data.reduce((acc, x) => {
            (acc[x[key]] = acc[x[key]] || []).push({date: new Date(x.date), value: x[value]});
            return acc;
        }, {});
    }
};

export const statsApiService = new StatsApiService();