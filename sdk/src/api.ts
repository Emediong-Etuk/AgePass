// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Emediong Etuk Gregory
//
// Typed AgePass contract API over Midnight.js. Environment-neutral: the CLI passes Node
// providers (wallet SDK, level DB, file-system keys) and the web app passes browser
// providers (Lace, fetched keys). Each AgePassAPI instance acts for ONE participant,
// identified by the private-state id it was joined with.

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import {
  type FoundContract,
  deployContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders, PublicDataProvider } from '@midnight-ntwrk/midnight-js-types';
import {
  Contract,
  ledger as decodeLedger,
  witnesses,
  type AgePassCircuitId,
  type AgePassPrivateState,
  type Ledger,
} from '@agepass/contract';
import { type AgePassChallenge, challengeToCircuitArgs } from './challenge.js';
import { type LedgerReader } from './verifier.js';

export type AgePassContract = Contract<AgePassPrivateState>;
export type AgePassProviders = MidnightProviders<AgePassCircuitId, string, AgePassPrivateState>;

/** Default private-state id. Use distinct ids to hold several roles in one store. */
export const AGEPASS_PRIVATE_STATE_ID = 'agepass';

/**
 * Binds the compiled contract to our witnesses. `assetsPath` points at the compiler output
 * (keys/ and zkir/); the zk-config provider decides how those files are actually loaded.
 */
export const makeCompiledAgePass = (assetsPath: string) =>
  CompiledContract.make<AgePassContract>('AgePass', Contract<AgePassPrivateState>).pipe(
    CompiledContract.withWitnesses(witnesses),
    CompiledContract.withCompiledFileAssets(assetsPath),
  );

export type CompiledAgePass = ReturnType<typeof makeCompiledAgePass>;

export type TxResult = { readonly txId: string; readonly blockHeight: number };

export async function readLedger(
  publicDataProvider: PublicDataProvider,
  contractAddress: string,
): Promise<Ledger | null> {
  const state = await publicDataProvider.queryContractState(contractAddress);
  return state === null ? null : decodeLedger(state.data);
}

export const ledgerReader =
  (publicDataProvider: PublicDataProvider, contractAddress: string): LedgerReader =>
  () =>
    readLedger(publicDataProvider, contractAddress);

type Deployed = FoundContract<AgePassContract>;

export class AgePassAPI {
  private constructor(
    private readonly providers: AgePassProviders,
    private readonly deployed: Deployed,
    readonly contractAddress: string,
    readonly privateStateId: string,
  ) {}

  /** Deploys a new AgePass. The caller's secret key becomes the admin. */
  static async deploy(
    providers: AgePassProviders,
    compiled: CompiledAgePass,
    adminState: AgePassPrivateState,
    privateStateId = AGEPASS_PRIVATE_STATE_ID,
  ): Promise<AgePassAPI> {
    const deployed = await deployContract(providers, {
      compiledContract: compiled,
      privateStateId,
      initialPrivateState: adminState,
    });
    const address = deployed.deployTxData.public.contractAddress;
    return new AgePassAPI(providers, deployed, address, privateStateId);
  }

  /**
   * Joins an existing deployment. Pass `privateState` to store (or overwrite) this
   * participant's private state; omit it to keep what is already stored under the id.
   */
  static async join(
    providers: AgePassProviders,
    compiled: CompiledAgePass,
    contractAddress: string,
    privateStateId = AGEPASS_PRIVATE_STATE_ID,
    privateState?: AgePassPrivateState,
  ): Promise<AgePassAPI> {
    const deployed =
      privateState === undefined
        ? await findDeployedContract(providers, {
            compiledContract: compiled,
            contractAddress,
            privateStateId,
          })
        : await findDeployedContract(providers, {
            compiledContract: compiled,
            contractAddress,
            privateStateId,
            initialPrivateState: privateState,
          });
    return new AgePassAPI(providers, deployed, contractAddress, privateStateId);
  }

  readLedger(): Promise<Ledger | null> {
    return readLedger(this.providers.publicDataProvider, this.contractAddress);
  }

  async privateState(): Promise<AgePassPrivateState | null> {
    this.providers.privateStateProvider.setContractAddress(this.contractAddress);
    return this.providers.privateStateProvider.get(this.privateStateId);
  }

  async setPrivateState(state: AgePassPrivateState): Promise<void> {
    this.providers.privateStateProvider.setContractAddress(this.contractAddress);
    await this.providers.privateStateProvider.set(this.privateStateId, state);
  }

  addIssuer(issuerPk: Uint8Array): Promise<TxResult> {
    return this.done(this.deployed.callTx.addIssuer(issuerPk));
  }

  removeIssuer(issuerPk: Uint8Array): Promise<TxResult> {
    return this.done(this.deployed.callTx.removeIssuer(issuerPk));
  }

  issueCredential(c: {
    birthDate: bigint;
    expiresOn: bigint;
    holderPk: Uint8Array;
  }): Promise<TxResult> {
    return this.done(this.deployed.callTx.issueCredential(c.birthDate, c.expiresOn, c.holderPk));
  }

  /**
   * Answers a site's challenge. Midnight.js first runs the circuit locally; if any assert
   * fails (underage, expired, not issued) it throws *before* a proof is generated, so no
   * transaction is ever created and nothing reaches the chain.
   */
  proveAge(challenge: AgePassChallenge): Promise<TxResult> {
    const a = challengeToCircuitArgs(challenge);
    return this.done(
      this.deployed.callTx.proveAge(a.challengeId, a.siteId, a.cutoffDate, a.checkedOn),
    );
  }

  private async done(p: Promise<{ public: { txId: string; blockHeight: number } }>) {
    const { public: pub } = await p;
    return { txId: pub.txId, blockHeight: pub.blockHeight };
  }
}
