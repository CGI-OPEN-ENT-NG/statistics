import { idiom as lang } from "entcore";

export type DatasetKey = 'Total' | 'Average' | 'Student' | 'Relative' | 'Teacher' | 'Personnel' | 'Guest' | 'desktop' |
	'mobile_app' | 'tablet' | 'smartphone' | 'other';

export type Dataset = {
    key?: DatasetKey;
    label: string;
		borderColor?: string;
		backgroundColor: string;
    borderWidth?: number;
		pointBackgroundColor?: string;
		pointBorderWidth?: number;		
	fill?: boolean | string | number;
	lineTension?: number;
	spanGaps?: boolean;
	minBarLength?: number;
    data: Array<number>;
}

const LINE_TENSION_CONFIG: number = 0.3;
const FILL_CONFIG:boolean = false;
const BORDER_WIDTH_CONFIG:number = 2;

export class DatasetService {

	public getAllProfilesDataset(): Array<Dataset> {
		return [{
				key: 'Teacher',
				label: lang.translate("stats.teacher"),
				borderColor: 'rgba(111, 190, 46, 0.75)',
				backgroundColor: 'rgba(111, 190, 46, 0.75)',
				pointBackgroundColor: 'rgba(111, 190, 46, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'Personnel',
				label: lang.translate("stats.personnel"),
				borderColor: 'rgba(163, 72, 192, 0.75)',
				backgroundColor: 'rgba(163, 72, 192, 0.75)',
				pointBackgroundColor: 'rgba(163, 72, 192, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'Relative',
				label: lang.translate("stats.relative"),
				borderColor: 'rgba(70, 175, 230, 0.75)',
				backgroundColor: 'rgba(70, 175, 230, 0.75)',
				pointBackgroundColor: 'rgba(70, 175, 230, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'Student',
				label: lang.translate("stats.student"),
				borderColor: 'rgba(255, 141, 46, 0.75)',
				backgroundColor: 'rgba(255, 141, 46, 0.75)',
				pointBackgroundColor: 'rgba(255, 141, 46, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'Guest',
				label: lang.translate("stats.guest"),
				borderColor: 'rgba(255, 58, 85, 0.75)',
				backgroundColor: 'rgba(255, 58, 85, 0.75)',
				pointBackgroundColor: 'rgba(255, 58, 85, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}
		]
    }
	
	public getAllProfilesWithTotalDataset(): Array<Dataset> {
		const res = this.getAllProfilesDataset();
		res.unshift({
			key: 'Total',
			label: lang.translate("stats.total"),
			borderColor: 'rgba(140, 147, 158, 0.75)',
			backgroundColor: 'rgba(140, 147, 158, 0.75)',
			pointBackgroundColor: 'rgba(201, 202, 215, 1)',
			pointBorderWidth: 5,
			borderWidth: BORDER_WIDTH_CONFIG,
			fill: FILL_CONFIG,
			lineTension: LINE_TENSION_CONFIG,
			data: []
		});
		return res;
	}
	
	public getAllProfilesWithAverageDataset(): Array<Dataset> {
		const res = this.getAllProfilesDataset();
		res.unshift({
			key: 'Average',
			label: lang.translate("stats.average"),
			borderColor: 'rgba(140, 147, 158, 0.75)',
			backgroundColor: 'rgba(140, 147, 158, 0.75)',
			pointBackgroundColor: 'rgba(140, 147, 158, 1)',
			pointBorderWidth: 5,
			borderWidth: BORDER_WIDTH_CONFIG,
			fill: FILL_CONFIG,
			lineTension: LINE_TENSION_CONFIG,
			data: []
		});
		return res;
    }
    
    public getDatasetByProfile(profile): Array<Dataset> {
		return [{
            label: lang.translate('stats.' + profile.toLowerCase()),
            backgroundColor: "rgba(56, 137, 193, 0.75)",
			minBarLength: 4,
			data: []
        }];
	}
	
	public getDevicesDataset(): Array<Dataset> {
		return [{
				key: 'desktop',
				label: lang.translate("stats.device.desktop"),
				borderColor: 'rgba(111, 190, 46, 0.75)',
				backgroundColor: 'rgba(111, 190, 46, 0.75)',
				pointBackgroundColor: 'rgba(111, 190, 46, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'mobile_app',
				label: lang.translate("stats.device.mobile_app"),
				borderColor: 'rgba(163, 72, 192, 0.75)',
				backgroundColor: 'rgba(163, 72, 192, 0.75)',
				pointBackgroundColor: 'rgba(163, 72, 192, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'tablet',
				label: lang.translate("stats.device.tablet"),
				borderColor: 'rgba(70, 175, 230, 0.75)',
				backgroundColor: 'rgba(70, 175, 230, 0.75)',
				pointBackgroundColor: 'rgba(70, 175, 230, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'smartphone',
				label: lang.translate("stats.device.smartphone"),
				borderColor: 'rgba(255, 141, 46, 0.75)',
				backgroundColor: 'rgba(255, 141, 46, 0.75)',
				pointBackgroundColor: 'rgba(255, 141, 46, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}, {
				key: 'other',
				label: lang.translate("stats.device.other"),
				borderColor: 'rgba(255, 58, 85, 0.75)',
				backgroundColor: 'rgba(255, 58, 85, 0.75)',
				pointBackgroundColor: 'rgba(255, 58, 85, 1)',
				pointBorderWidth: 5,
				borderWidth: BORDER_WIDTH_CONFIG,
				fill: FILL_CONFIG,
				lineTension: LINE_TENSION_CONFIG,
				data: []
			}
		]
    }
}

export const datasetService = new DatasetService();