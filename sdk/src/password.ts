// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// The Midnight.js 4.x level private-state provider encrypts private state with a password
// and enforces a strength policy (midnight-js-utils `validatePassword`). We call that exact
// policy up front, so the app can show a precise message before any storage is touched,
// and translate each rule into plain language.

import {
  PasswordValidationError,
  type PasswordValidationFailure,
  validatePassword,
} from '@midnight-ntwrk/midnight-js-utils';

export type PasswordProblem = PasswordValidationFailure;

export const PASSWORD_RULES: Record<PasswordProblem, string> = {
  missing: 'Enter a passphrase.',
  too_short: 'Use at least 16 characters.',
  insufficient_classes:
    'Mix at least 3 of: lower-case letters, upper-case letters, digits, symbols.',
  repeated_characters: 'Avoid the same character 4 or more times in a row (like "aaaa").',
  sequential_pattern: 'Avoid runs of 4 sequential characters (like "1234" or "dcba").',
};

/** Human-readable checklist shown next to the passphrase field. */
export const PASSWORD_HINT =
  '16+ characters, at least 3 of lower/upper/digit/symbol, no "aaaa" or "1234" runs.';

/** The first rule the password breaks, or null when it is acceptable. */
export function passwordProblem(password: string): PasswordProblem | null {
  try {
    validatePassword(password);
    return null;
  } catch (e) {
    if (e instanceof PasswordValidationError) return e.reason;
    throw e;
  }
}

export class AgePassPasswordError extends Error {
  constructor(readonly problem: PasswordProblem) {
    super(`AgePass: passphrase is too weak. ${PASSWORD_RULES[problem]}`);
    this.name = 'AgePassPasswordError';
  }
}

export function assertStrongPassword(password: string): void {
  const problem = passwordProblem(password);
  if (problem !== null) throw new AgePassPasswordError(problem);
}
