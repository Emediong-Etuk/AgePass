// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// In-memory test bed: runs the compiled circuits against a local copy of the public ledger,
// with no node, indexer, proof server or wallet. One shared ledger, many actors: switch
// private state with `as(...)` to act as the admin, an issuer or a holder.

import {
  type CircuitContext,
  type CircuitResults,
  type ProofData,
  ContractState,
  CostModel,
  QueryContext,
  type StateValue,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import {
  Contract,
  type Ledger,
  type Witnesses,
  ledger,
} from '../managed/agepass/contract/index.js';
import { type AgePassPrivateState, createAgePassPrivateState, witnesses } from '../witnesses.js';

type W = Witnesses<AgePassPrivateState>;

export class AgePassSimulator {
  private context: CircuitContext<AgePassPrivateState>;
  /** Proof data of the last successful transaction: what would be proven and submitted. */
  lastProofData: ProofData | undefined;

  constructor(adminSecretKey: Uint8Array) {
    const contract = new Contract<AgePassPrivateState>(witnesses);
    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      contract.initialState(
        createConstructorContext(createAgePassPrivateState(adminSecretKey), '0'.repeat(64)),
      );
    this.context = {
      currentPrivateState,
      currentZswapLocalState,
      costModel: CostModel.initialCostModel(),
      currentQueryContext: new QueryContext(currentContractState.data, sampleContractAddress()),
    };
  }

  /** Act as a different participant from now on (their private state, same public ledger). */
  as(privateState: AgePassPrivateState): this {
    this.context = { ...this.context, currentPrivateState: privateState };
    return this;
  }

  ledger(): Ledger {
    return ledger(this.context.currentQueryContext.state);
  }

  privateState(): AgePassPrivateState {
    return this.context.currentPrivateState;
  }

  /**
   * Hex dump of everything an observer can read about this contract: the serialized
   * on-chain contract state, plus every cell value and map key reached by walking the state
   * tree (the debug renderer elides nested parts, so we walk it ourselves).
   */
  publicStateDump(): string {
    const charged = this.context.currentQueryContext.state;
    const cs = new ContractState();
    cs.data = charged;
    const parts = [Buffer.from(cs.serialize()).toString('hex')];
    walk(charged.state, parts);
    return parts.join('\n');
  }

  addIssuer(issuerPk: Uint8Array, overrides?: Partial<W>): void {
    this.run(overrides, (c, ctx) => c.impureCircuits.addIssuer(ctx, issuerPk));
  }

  removeIssuer(issuerPk: Uint8Array, overrides?: Partial<W>): void {
    this.run(overrides, (c, ctx) => c.impureCircuits.removeIssuer(ctx, issuerPk));
  }

  issueCredential(
    birthDate: bigint,
    expiresOn: bigint,
    holderPk: Uint8Array,
    overrides?: Partial<W>,
  ): void {
    this.run(overrides, (c, ctx) =>
      c.impureCircuits.issueCredential(ctx, birthDate, expiresOn, holderPk),
    );
  }

  proveAge(
    challenge: {
      challengeId: Uint8Array;
      siteId: Uint8Array;
      cutoffDate: bigint;
      checkedOn: bigint;
    },
    overrides?: Partial<W>,
  ): void {
    this.run(overrides, (c, ctx) =>
      c.impureCircuits.proveAge(
        ctx,
        challenge.challengeId,
        challenge.siteId,
        challenge.cutoffDate,
        challenge.checkedOn,
      ),
    );
  }

  /**
   * Execute one circuit. On failure the exception propagates and the context is untouched,
   * which models the real network: a failed local execution never becomes a transaction.
   * `overrides` swaps individual witnesses so tests can play a malicious holder.
   */
  private run(
    overrides: Partial<W> | undefined,
    call: (
      c: Contract<AgePassPrivateState>,
      ctx: CircuitContext<AgePassPrivateState>,
    ) => CircuitResults<AgePassPrivateState, []>,
  ): void {
    const contract = new Contract<AgePassPrivateState>({ ...witnesses, ...overrides });
    const result = call(contract, this.context);
    this.context = result.context;
    this.lastProofData = result.proofData;
  }
}

const hexOf = (v: { value: Uint8Array[] }): string =>
  v.value.map((b) => Buffer.from(b).toString('hex')).join('|');

function walk(sv: StateValue, out: string[]): void {
  switch (sv.type()) {
    case 'cell':
      out.push(hexOf(sv.asCell()));
      break;
    case 'array':
      for (const child of sv.asArray() ?? []) walk(child, out);
      break;
    case 'map': {
      const map = sv.asMap();
      for (const k of map?.keys() ?? []) {
        out.push(hexOf(k));
        const child = map?.get(k);
        if (child !== undefined) walk(child, out);
      }
      break;
    }
    case 'boundedMerkleTree':
      out.push(sv.asBoundedMerkleTree()?.toString(false) ?? '');
      break;
    default:
      break;
  }
}
