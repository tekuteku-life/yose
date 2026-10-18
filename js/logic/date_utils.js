/**
 * Yoseatsume Kakeibo - Date, Holiday, ID & HTML Escape Utilities
 */

/**
 * Format Date object to YYYY-MM-DD
 */
export function formatDate(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/**
 * Parse YYYY-MM-DD to Date in local time
 */
export function parseDate(dateStr) {
	const [y, m, d] = dateStr.split('-').map(Number);
	return new Date(y, m - 1, d);
}

/**
 * Add months to a YYYY-MM string
 */
export function addMonthsToMonthStr(monthStr, monthsToAdd) {
	const [y, m] = monthStr.split('-').map(Number);
	const totalMonths = (y * 12 + (m - 1)) + monthsToAdd;
	const newY = Math.floor(totalMonths / 12);
	const newM = (totalMonths % 12) + 1;
	return `${newY}-${String(newM).padStart(2, '0')}`;
}

/**
 * Get last day of month for a given year and month (1-indexed month)
 */
export function getLastDayOfMonth(year, month) {
	return new Date(year, month, 0).getDate();
}

/**
 * Check if a date string (YYYY-MM-DD) is Saturday or Sunday
 */
export function isWeekend(dateStr) {
	const d = parseDate(dateStr);
	const day = d.getDay();
	return day === 0 || day === 6;
}

/**
 * Check if a date string is in the holidays list
 */
export function isHoliday(dateStr, holidays = []) {
	return Array.isArray(holidays) && holidays.includes(dateStr);
}

/**
 * Check if a date string is a business day (not weekend and not holiday)
 */
export function isBusinessDay(dateStr, holidays = []) {
	return !isWeekend(dateStr) && !isHoliday(dateStr, holidays);
}

/**
 * Adjust date for weekends and Japanese holidays based on rule
 * @param {string} dateStr - YYYY-MM-DD
 * @param {"none" | "before" | "after"} adjustmentRule
 * @param {string[]} holidays
 * @returns {string} adjusted date string (YYYY-MM-DD)
 */
export function adjustDateForHoliday(dateStr, adjustmentRule = 'none', holidays = []) {
	if (!adjustmentRule || adjustmentRule === 'none') {
		return dateStr;
	}

	const d = parseDate(dateStr);

	if (adjustmentRule === 'before') {
		while (!isBusinessDay(formatDate(d), holidays)) {
			d.setDate(d.getDate() - 1);
		}
	} else if (adjustmentRule === 'after') {
		while (!isBusinessDay(formatDate(d), holidays)) {
			d.setDate(d.getDate() + 1);
		}
	}

	return formatDate(d);
}

/**
 * Built-in Japanese Public Holidays Preset (2024 - 2028)
 */
export const JAPANESE_HOLIDAYS_PRESET = [
	// 2024
	'2024-01-01', '2024-01-08', '2024-02-11', '2024-02-12', '2024-02-23',
	'2024-03-20', '2024-04-29', '2024-05-03', '2024-05-04', '2024-05-05', '2024-05-06',
	'2024-07-15', '2024-08-11', '2024-08-12', '2024-09-16', '2024-09-22', '2024-09-23',
	'2024-10-14', '2024-11-03', '2024-11-04', '2024-11-23',
	// 2025
	'2025-01-01', '2025-01-13', '2025-02-11', '2025-02-23', '2025-02-24',
	'2025-03-20', '2025-04-29', '2025-05-03', '2025-05-04', '2025-05-05', '2025-05-06',
	'2025-07-21', '2025-08-11', '2025-09-15', '2025-09-23',
	'2025-10-13', '2025-11-03', '2025-11-23', '2025-11-24',
	// 2026
	'2026-01-01', '2026-01-12', '2026-02-11', '2026-02-23',
	'2026-03-20', '2026-04-29', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06',
	'2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22', '2026-09-23',
	'2026-10-12', '2026-11-03', '2026-11-23',
	// 2027
	'2027-01-01', '2027-01-11', '2027-02-11', '2027-02-23',
	'2027-03-21', '2027-03-22', '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05',
	'2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
	'2027-10-11', '2027-11-03', '2027-11-23',
	// 2028
	'2028-01-01', '2028-01-10', '2028-02-11', '2028-02-23',
	'2028-03-20', '2028-04-29', '2028-05-03', '2028-05-04', '2028-05-05',
	'2028-07-17', '2028-08-11', '2028-09-18', '2028-09-22',
	'2028-10-09', '2028-11-03', '2028-11-23'
];

function normalizeDateStr(str) {
	const [y, m, d] = str.replace(/\//g, '-').split('-');
	return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Parse text, CSV, or JSON string containing holiday dates
 * @param {string} raw - user input, CSV string, or JSON
 * @returns {string[]} sorted, unique array of YYYY-MM-DD date strings
 */
export function parseHolidayTextOrCsv(raw) {
	if (!raw || typeof raw !== 'string') return [];
	const found = new Set();

	try {
		const parsed = JSON.parse(raw);
		if (Array.isArray(parsed)) {
			parsed.forEach(item => {
				if (typeof item === 'string') {
					const m = item.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/);
					if (m) found.add(normalizeDateStr(m[0]));
				} else if (item && typeof item === 'object') {
					const dateVal = item.date || item.Date || item.holiday_date;
					if (dateVal) {
						const m = String(dateVal).match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/);
						if (m) found.add(normalizeDateStr(m[0]));
					}
				}
			});
		} else if (parsed && typeof parsed === 'object') {
			Object.keys(parsed).forEach(k => {
				const m = k.match(/\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/);
				if (m) found.add(normalizeDateStr(m[0]));
			});
		}
	} catch (e) {
		// Not JSON, fall through to regex scan
	}

	const regex = /\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/g;
	let match;
	while ((match = regex.exec(raw)) !== null) {
		const y = match[1];
		const m = match[2].padStart(2, '0');
		const d = match[3].padStart(2, '0');
		found.add(`${y}-${m}-${d}`);
	}

	return Array.from(found).sort();
}

/**
 * Groups a list of holiday date strings by year in ascending order.
 * @param {string[]} holidays
 * @returns {Record<string, string[]>}
 */
export function groupHolidaysByYear(holidays) {
	if (!Array.isArray(holidays)) return {};
	const groups = {};
	for (const h of holidays) {
		if (typeof h === 'string' && /^\d{4}-\d{2}-\d{2}/.test(h)) {
			const year = h.slice(0, 4);
			if (!groups[year]) groups[year] = [];
			groups[year].push(h);
		}
	}
	for (const y of Object.keys(groups)) {
		groups[y].sort();
	}
	return groups;
}

/**
 * Generate a unique ID with optional prefix
 */
export function generateUUID(prefix = 'tx') {
	const rnd = Math.random().toString(36).substring(2, 9);
	const timestamp = Date.now().toString(36);
	return `${prefix}_${timestamp}_${rnd}`;
}

/**
 * Safely escape HTML characters to prevent XSS injection
 */
export function escapeHtml(str) {
	if (str === null || str === undefined) return '';
	return String(str)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

