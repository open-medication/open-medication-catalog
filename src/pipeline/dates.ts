/** Data release 2026.09 is built from Swissmedic archive OGD_202609.zip (as-of previous month-end). */

export interface ReleaseCalendar {
  /** e.g. 2026.09 */
  dataMonth: string;
  /** e.g. 202609 — Swissmedic archive filename month (creation month) */
  archiveMonth: string;
  /** e.g. 2026-08-31 */
  cutoffDate: string;
}

export function calendarForDate(now: Date = new Date()): ReleaseCalendar {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1; // 1-12
  return calendarForYearMonth(y, m);
}

export function calendarForYearMonth(year: number, month: number): ReleaseCalendar {
  const dataMonth = `${year}.${String(month).padStart(2, "0")}`;
  const archiveMonth = `${year}${String(month).padStart(2, "0")}`;
  const prev = new Date(Date.UTC(year, month - 1, 0)); // last day of previous month
  const cutoffDate = prev.toISOString().slice(0, 10);
  return { dataMonth, archiveMonth, cutoffDate };
}

export function parseDataMonth(value: string): ReleaseCalendar {
  const m = value.match(/^(\d{4})\.(\d{2})$/);
  if (!m) throw new Error(`Invalid data month ${value}; expected YYYY.MM`);
  return calendarForYearMonth(Number(m[1]), Number(m[2]));
}

/** Shift a YYYY.MM label by a whole number of months (UTC). */
export function addDataMonths(dataMonth: string, delta: number): string {
  const cal = parseDataMonth(dataMonth);
  const year = Number(cal.dataMonth.slice(0, 4));
  const month = Number(cal.dataMonth.slice(5));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return calendarForYearMonth(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1).dataMonth;
}

/**
 * Data months to consider for a new release, oldest first.
 * After a shipped month: (lastShipped+1) … current.
 * With no prior release: (current − lookback) … current.
 */
export function monthsToProbe(opts: {
  lastShipped?: string;
  current: string;
  lookbackMonths?: number;
}): string[] {
  parseDataMonth(opts.current);
  const lookback = opts.lookbackMonths ?? 12;
  const start = opts.lastShipped
    ? addDataMonths(opts.lastShipped, 1)
    : addDataMonths(opts.current, -lookback);
  if (start > opts.current) return [];
  const out: string[] = [];
  for (let month = start; month <= opts.current; month = addDataMonths(month, 1)) {
    out.push(month);
  }
  return out;
}
