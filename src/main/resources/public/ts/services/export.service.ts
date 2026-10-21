import { Indicator } from "../indicators/abstractIndicator";
import { dateService } from "./date.service";
import { Entity } from "./entities.service";

export type ExportType = 'topLevel.aggregated' | 'topLevel.substructures' | 'bottomLevel.structure' | 'bottomLevel.structure.classes' | 'user.classes';

export class ExportService {
    private static readonly INSTANCE = new ExportService();
    private constructor() {}

    public static getInstance() {
        return ExportService.INSTANCE;
    }

    getExportUrl(entity: Entity, indicator: Indicator, exportType: ExportType): string {
		let exportBaseUrl = '/stats/export';
		let exportParams = `?indicator=${indicator.api}&from=${dateService.getSinceDateISOStringWithoutMs()}`;
		const to = dateService.getToDateISOStringWithoutMs();
		if (to) {
			exportParams += `&to=${to}`;
		}
		const frequency = indicator.exportFrequency ? indicator.exportFrequency : indicator.frequency;
		exportParams += `&frequency=${frequency}`;
	
		switch (exportType) {
			case 'topLevel.aggregated':
				exportParams += '&entityLevel=structure';
				exportParams += `&entity=${entity.id}`;
				exportParams += '&accumulate=true';
				break;
			case 'topLevel.substructures':
				exportParams += '&entityLevel=structure';
				exportParams += `&entity=${entity.id}`;
				exportParams += '&substructures=true';
				break;
			case 'bottomLevel.structure':
				exportParams += '&entityLevel=structure';
				exportParams += `&entity=${entity.id}`;
				break;
			case 'bottomLevel.structure.classes':
				exportParams += '&entityLevel=structure';
				exportParams += `&entity=${entity.id}`;
				exportParams += '&structureClasses=true';
				break;
			case 'user.classes':
				exportParams += '&entityLevel=structure';
				exportParams += `&entity=${entity.parentStructureId}`;
				exportParams += '&userClasses=true';
				break;
			default:
				break;
		}

		if (indicator.name === 'stats.mostUsedConnector' || indicator.name === 'stats.connectorDetails') {
			exportParams += '&type=CONNECTOR';
		} else if (indicator.name === 'stats.mostUsedApp' || indicator.name === 'stats.appDetails') {
			exportParams += '&type=ACCESS';
		} else if (indicator.name === 'stats.devices') {
			exportParams += '&device=true';
		}

		return encodeURI(`${exportBaseUrl}${exportParams}`);
    }
}