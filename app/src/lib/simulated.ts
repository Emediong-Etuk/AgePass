// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// "Try it without a wallet": runs the real compiled AgePass circuits in the browser against
// an in-memory copy of the public ledger. Same contract logic as on Midnight (every rule is
// enforced), but no proofs, no wallet, no fees and nothing leaves the page.

import {
  type CircuitContext,
  type CircuitResults,
  CostModel,
  QueryContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  type AgePassPrivateState,
  Contract,
  type Ledger,
  createAgePassPrivateState,
  ledger,
  witnesses,
} from '@agepass/contract';
import type { ChallengeCircuitArgs } from '@agepass/sdk';

export class SimulatedAgePass {
  private context: CircuitContext<AgePassPrivateState>;
  private readonly contract = new Contract<AgePassPrivateState>(witnesses);

  /** "Deploys" a fresh contract; the holder of `adminSecretKey` becomes its admin. */
  constructor(adminSecretKey: Uint8Array) {
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      this.contract.initialState(
        createConstructorContext(createAgePassPrivateState(adminSecretKey), '0'.repeat(64)),
      );
    this.context = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  /** Everything an observer of the chain could read. */
  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  addIssuer(as: AgePassPrivateState, issuerPk: Uint8Array): void {
    this.run(as, (c, ctx) => c.impureCircuits.addIssuer(ctx, issuerPk));
  }

  issueCredential(
    as: AgePassPrivateState,
    birthDate: bigint,
    expiresOn: bigint,
    holderPk: Uint8Array,
  ): void {
    this.run(as, (c, ctx) => c.impureCircuits.issueCredential(ctx, birthDate, expiresOn, holderPk));
  }

  proveAge(as: AgePassPrivateState, args: ChallengeCircuitArgs): void {
    this.run(as, (c, ctx) =>
      c.impureCircuits.proveAge(
        ctx,
        args.challengeId,
        args.siteId,
        args.cutoffDate,
        args.checkedOn,
      ),
    );
  }

  /**
   * Runs one circuit as `as`. On failure the exception propagates and the ledger is left
   * untouched, exactly like a real transaction that fails before it is ever submitted.
   */
  private run(
    as: AgePassPrivateState,
    call: (
      c: Contract<AgePassPrivateState>,
      ctx: CircuitContext<AgePassPrivateState>,
    ) => CircuitResults<AgePassPrivateState, []>,
  ): void {
    const result = call(this.contract, { ...this.context, currentPrivateState: as });
    this.context = result.context;
  }
}
