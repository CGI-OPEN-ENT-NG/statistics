import { idiom as lang, currentLanguage } from "entcore";
import { StatsResponse } from "./stats-api.service";
import { IndicatorFrequency } from "../indicators/abstractIndicator";

export class DateService {

	public getDatesFromData(data: Array<StatsResponse>): Array<Date> {
		let dateArray: Array<Date> = [];
		data.forEach(d => {
			const date = new Date(d.date);
			if (!dateArray.find(x => x.getTime() === date.getTime())) {
				dateArray.push(date);
			}
		});
		return dateArray;
	}
	
	public getMinDateFromData(data: Array<StatsResponse>): Date {
		return new Date(data.reduce((a, b) => new Date(a.date) < new Date(b.date) ? a : b).date);
	}
	
	public getMaxDateFromData(data: Array<StatsResponse>): Date {
		return new Date(data.reduce((a, b) => new Date(a.date) > new Date(b.date) ? a : b).date);
	}
	
	public getDates(minDate: Date, maxDate: Date, frequency: IndicatorFrequency): Array<Date> {
		let datesArray: Array<Date> = [];
		let resDate = minDate;
		datesArray.push(new Date(resDate));
		
		while (resDate < maxDate) {
			switch (frequency) {
				case 'month':
					resDate.setMonth(resDate.getMonth() + 1);
					break;
				case 'week':
					resDate.setDate(resDate.getDate() + 7);
					break;
				case 'day':
					resDate.setDate(resDate.getDate() + 1);
					break;
				default:
					break;
			}
			datesArray.push(new Date(resDate));
		}
		return datesArray;
	}
	
	public isInSameRange(date1: Date, date2: Date, frequency: IndicatorFrequency): boolean {
		switch (frequency) {
			case 'month':
				return this.isSameMonth(date1, date2);
			case 'week':
				const date1WeekNumber = this.getWeekNumber(date1);
				const date2WeekNumber = this.getWeekNumber(date2);
				return date1WeekNumber === date2WeekNumber && date1.getFullYear() === date2.getFullYear();
			case 'day':
				return this.isSameMonth(date1, date2) && date1.getDate() === date2.getDate();
			default:
				break;
		}
	}
	
	public isSameMonth(date1: Date, date2: Date): boolean {
		return date1.getFullYear() === date2.getFullYear() && date1.getMonth() === date2.getMonth();
	}
	
	private getWeekNumber(date: Date): number {
		const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
		const pastDaysOfYear = (date.getTime() - firstDayOfYear.getTime()) / 86400000;
		return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
	};
	
	public getMonthLabels(dates: Array<Date>): Array<string> {
		return dates.map(d => d.toLocaleString([currentLanguage], { month: 'long', year: '2-digit' }));
	}

	public getWeekLabels(dates: Array<Date>) {
		return dates.map(date => {
			const firstDayOfTheWeek = date.getDate() - date.getDay() + 1; // + 1 to start on Monday
			return lang.translate("stats.weekOf") 
				+ firstDayOfTheWeek 
				+ '/' 
				+ date.toLocaleString([currentLanguage], { month: '2-digit' })
		})
	}
	
	public getDayLabels(dates: Array<Date>) {
		return dates.map(date => date.toLocaleString([currentLanguage], { day: '2-digit', month: '2-digit', year: 'numeric' }));
	}
	
	private rangeFrom: Date = null;
	private rangeTo: Date = null;

	public getDefaultSinceDate(): Date {
		const today = new Date();
		return new Date(today.getFullYear() - 1, today.getMonth(), 1, 0, 0, 0, 0);
	}

    public getSinceDate(): Date {
		return this.rangeFrom ? new Date(this.rangeFrom) : this.getDefaultSinceDate();
    }

	public getToDate(): Date {
		return this.rangeTo ? new Date(this.rangeTo) : null;
	}

	/**
	 * Set the displayed period, from the first day to the end of the last day (null: up to now)
	 */
	public setRange(from: Date, to: Date): void {
		this.rangeFrom = from ? new Date(from.getFullYear(), from.getMonth(), from.getDate(), 0, 0, 0, 0) : null;
		this.rangeTo = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 0) : null;
	}

	public getSinceDateISOStringWithoutMs(): string {
		return this.getSinceDate().toISOString().split('.')[0];
	}

	public getToDateISOStringWithoutMs(): string {
		return this.rangeTo ? this.rangeTo.toISOString().split('.')[0] : '';
	}
	
	public moreThanOneHourAgo(date: Date): boolean {
		if (!date) {
			return true;
		}
		const HOUR = 1000 * 60 * 60;
		const anHourAgo = Date.now() - HOUR;
	
		return date.getTime() < anHourAgo;
	}
}

export const dateService = new DateService();