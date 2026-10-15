// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Public entry point of the contract package: the compiler-generated contract plus our
// witnesses. The SDK, CLI and app import everything contract-related from here.

export * from './managed/agepass/contract/index.js';
export * from './witnesses.js';

/** Circuits that create transactions. Used to locate prover/verifier keys and zkir files. */
export const AGEPASS_CIRCUITS = [
  'addIssuer',
  'removeIssuer',
  'issueCredential',
  'proveAge',
] as const;
export type AgePassCircuitId = (typeof AGEPASS_CIRCUITS)[number];

/** Depth of the credentials HistoricMerkleTree, as declared in agepass.compact. */
export const CREDENTIAL_TREE_DEPTH = 16;
