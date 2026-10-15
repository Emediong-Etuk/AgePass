// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Dates cross into the circuit as Uint<32> in YYYYMMDD form (e.g. 20070115). Numeric order
// of YYYYMMDD equals calendar order, so the circuit only needs `<=`. All calendar logic
// lives here, in one tested place, and works in UTC so a user's timezone cannot shift a day.

export type CalendarDate = { readonly year: number; readonly month: number; readonly day: number };

export class AgePassDateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgePassDateError';
  }
}

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export const daysInMonth = (year: number, month: number): number =>
  [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1] ?? 0;

export const isValidCalendarDate = ({ year, month, day }: CalendarDate): boolean =>
  Number.isInteger(year) &&
  Number.isInteger(month) &&
  Number.isInteger(day) &&
  year >= 1000 &&
  year <= 9999 &&
  month >= 1 &&
  month <= 12 &&
  day >= 1 &&
  day <= daysInMonth(year, month);

/** Calendar date (or a JS Date, read in UTC) → YYYYMMDD as the circuit expects it. */
export function toYYYYMMDD(date: Date | CalendarDate): bigint {
  const d =
    date instanceof Date
      ? { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() }
      : date;
  if (!isValidCalendarDate(d)) {
    throw new AgePassDateError(`AgePass: ${JSON.stringify(d)} is not a real calendar date`);
  }
  return BigInt(d.year * 10_000 + d.month * 100 + d.day);
}

export function fromYYYYMMDD(value: bigint | number): CalendarDate {
  const n = Number(value);
  const d = { year: Math.floor(n / 10_000), month: Math.floor(n / 100) % 100, day: n % 100 };
  if (!isValidCalendarDate(d)) {
    throw new AgePassDateError(`AgePass: ${value} is not a valid YYYYMMDD date`);
  }
  return d;
}

/** "2007-01-15" → 20070115n. Rejects anything that is not a real date. */
export function parseIsoDate(iso: string): bigint {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (m === null) {
    throw new AgePassDateError(`AgePass: "${iso}" must look like YYYY-MM-DD`);
  }
  return toYYYYMMDD({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
}

/** 20070115n → "2007-01-15". */
export function formatIsoDate(value: bigint | number): string {
  const { year, month, day } = fromYYYYMMDD(value);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Latest birth date that makes someone at least `minAge` on `today`.
 *
 * Same month/day, `minAge` years earlier. When `today` is 29 February and the earlier year
 * is not a leap year, clamp to 28 February: someone born on 28 Feb has had their birthday,
 * someone born on 1 Mar has not. A person born on 29 Feb is therefore treated as having their
 * birthday on 1 March in non-leap years (the convention used in, e.g., the UK).
 */
export function cutoffForAge(minAge: number, today: Date | CalendarDate = new Date()): bigint {
  if (!Number.isInteger(minAge) || minAge < 0 || minAge > 150) {
    throw new AgePassDateError(`AgePass: minimum age ${minAge} is not a sensible age`);
  }
  const t = fromYYYYMMDD(toYYYYMMDD(today));
  const year = t.year - minAge;
  const day = Math.min(t.day, daysInMonth(year, t.month));
  return toYYYYMMDD({ year, month: t.month, day });
}

/** Age in whole years on `today`, consistent with `cutoffForAge`. For display only. */
export function ageOn(birthDate: bigint, today: Date | CalendarDate = new Date()): number {
  const b = fromYYYYMMDD(birthDate);
  const t = fromYYYYMMDD(toYYYYMMDD(today));
  let age = t.year - b.year;
  if (birthDate > cutoffForAge(age, t)) age -= 1;
  return age;
}
