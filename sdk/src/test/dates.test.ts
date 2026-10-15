// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory

import { describe, expect, it } from 'vitest';
import {
  AgePassDateError,
  ageOn,
  cutoffForAge,
  formatIsoDate,
  fromYYYYMMDD,
  parseIsoDate,
  toYYYYMMDD,
} from '../dates.js';

describe('toYYYYMMDD / fromYYYYMMDD', () => {
  it('encodes calendar dates as the integer the circuit compares', () => {
    expect(toYYYYMMDD({ year: 2007, month: 1, day: 15 })).toBe(20070115n);
    expect(toYYYYMMDD(new Date(Date.UTC(2026, 9, 15)))).toBe(20261015n);
  });

  it('reads a JS Date in UTC so the local timezone cannot shift the day', () => {
    expect(toYYYYMMDD(new Date('2026-10-15T23:59:59.999Z'))).toBe(20261015n);
    expect(toYYYYMMDD(new Date('2026-10-16T00:00:00.000Z'))).toBe(20261016n);
  });

  it('round-trips', () => {
    expect(fromYYYYMMDD(20080229n)).toEqual({ year: 2008, month: 2, day: 29 });
    expect(formatIsoDate(20070115n)).toBe('2007-01-15');
    expect(parseIsoDate('2007-01-15')).toBe(20070115n);
  });

  it('keeps numeric order equal to calendar order across month and year ends', () => {
    const days = [
      '2007-12-30',
      '2007-12-31',
      '2008-01-01',
      '2008-02-28',
      '2008-02-29',
      '2008-03-01',
    ];
    const values = days.map(parseIsoDate);
    expect([...values].sort((a, b) => (a < b ? -1 : 1))).toEqual(values);
  });

  it.each(['2007-02-29', '2008-13-01', '2008-00-10', '2008-04-31', '08-01-01', 'yesterday', ''])(
    'rejects %j',
    (bad) => {
      expect(() => parseIsoDate(bad)).toThrow(AgePassDateError);
    },
  );

  it('rejects impossible encoded values', () => {
    expect(() => fromYYYYMMDD(20070230n)).toThrow(AgePassDateError);
    expect(() => toYYYYMMDD({ year: 2007, month: 2, day: 30 })).toThrow(AgePassDateError);
  });
});

describe('cutoffForAge', () => {
  it('is the same day N years earlier', () => {
    expect(cutoffForAge(18, { year: 2026, month: 10, day: 15 })).toBe(20081015n);
    expect(cutoffForAge(21, { year: 2026, month: 1, day: 1 })).toBe(20050101n);
  });

  it('clamps 29 February to 28 February when the earlier year is not a leap year', () => {
    expect(cutoffForAge(18, { year: 2028, month: 2, day: 29 })).toBe(20100228n);
    expect(cutoffForAge(16, { year: 2024, month: 2, day: 29 })).toBe(20080229n);
  });

  it('treats someone born on 29 February as 18 on 1 March in a non-leap year', () => {
    const born = 20080229n;
    expect(born <= cutoffForAge(18, { year: 2026, month: 2, day: 28 })).toBe(false);
    expect(born <= cutoffForAge(18, { year: 2026, month: 3, day: 1 })).toBe(true);
    expect(ageOn(born, { year: 2026, month: 2, day: 28 })).toBe(17);
    expect(ageOn(born, { year: 2026, month: 3, day: 1 })).toBe(18);
  });

  it('makes the 18th birthday itself pass and the day before fail', () => {
    const today = { year: 2026, month: 10, day: 15 };
    expect(20081015n <= cutoffForAge(18, today)).toBe(true);
    expect(20081016n <= cutoffForAge(18, today)).toBe(false);
    expect(ageOn(20081015n, today)).toBe(18);
    expect(ageOn(20081016n, today)).toBe(17);
  });

  it('rejects nonsense ages', () => {
    expect(() => cutoffForAge(-1)).toThrow(AgePassDateError);
    expect(() => cutoffForAge(18.5)).toThrow(AgePassDateError);
  });
});
