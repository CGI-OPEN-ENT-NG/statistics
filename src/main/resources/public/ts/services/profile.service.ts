import { idiom as lang } from "entcore";
import { StatsResponse } from "./stats-api.service";

/**
 * Profiles of the statistics: the ENT profiles (Teacher, Personnel...) or the Campus profiles (name of the KC_Profile
 * nodes, e.g. "Référent digital"), whatever the values found in the data.
 */
const PROFILES_ORDER = [
	'Personnel pédagogique', 'Référent digital', "Gestionnaire d'inscription", 'Responsable communication',
	'Apprenant', 'Elève du secondaire', 'Parent', 'Utilisateur extérieur', 'Invité',
	'Teacher', 'Personnel', 'Relative', 'Student', 'Guest'
];

const PROFILE_COLORS = {
	'Teacher': '111, 190, 46',
	'Personnel': '163, 72, 192',
	'Relative': '70, 175, 230',
	'Student': '255, 141, 46',
	'Guest': '255, 58, 85'
};

const PALETTE = [
	'111, 190, 46', '163, 72, 192', '70, 175, 230', '255, 141, 46', '255, 58, 85',
	'0, 150, 136', '121, 85, 72', '233, 30, 99', '63, 81, 181', '205, 220, 57'
];

/** profile values meaning no profile, counted in the totals only */
const NO_PROFILE_VALUES = ['null', ''];

export class ProfileService {

	/**
	 * Profiles found in the data: the known ones in a fixed order, then the others by name
	 */
	public getProfiles(data: Array<StatsResponse>): Array<string> {
		const profiles: Array<string> = [];
		(data || []).forEach(d => {
			if (d.profile && NO_PROFILE_VALUES.indexOf(d.profile) === -1 && profiles.indexOf(d.profile) === -1) {
				profiles.push(d.profile);
			}
		});
		return this.sort(profiles);
	}

	public sort(profiles: Array<string>): Array<string> {
		const rank = (p: string) => PROFILES_ORDER.indexOf(p) === -1 ? PROFILES_ORDER.length : PROFILES_ORDER.indexOf(p);
		return profiles
			.filter(p => p && NO_PROFILE_VALUES.indexOf(p) === -1)
			.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
	}

	/**
	 * Translation of stats.<profile> if any, else the profile itself (Campus profiles are already labels)
	 */
	public getLabel(profile: string): string {
		const key = 'stats.' + profile.toLowerCase();
		const translation = lang.translate(key);
		return translation && translation !== key ? translation : profile;
	}

	/**
	 * Profile filter of an indicator: total, then the profiles found in its data
	 */
	public initChartProfiles(indicator: {chartProfile: string, chartProfiles: Array<string>}, data: Array<StatsResponse>): void {
		indicator.chartProfiles = ['total'].concat(this.getProfiles(data));
		if (indicator.chartProfiles.indexOf(indicator.chartProfile) === -1) {
			indicator.chartProfile = 'total';
		}
	}

	/**
	 * Color of a profile: fixed for the ENT profiles, from its rank in the displayed profiles for the others
	 */
	public getColor(profile: string, index: number): string {
		return PROFILE_COLORS[profile] || PALETTE[index % PALETTE.length];
	}
}

export const profileService = new ProfileService();
