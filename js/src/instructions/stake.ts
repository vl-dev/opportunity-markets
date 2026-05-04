import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getStakeInstructionAsync,
  type StakeInstruction,
} from "../generated";
import { type ArciumConfig, getComputeAccounts } from "../arcium/computeAccounts";
import { type ByteArray, toNumberArray } from "../utils";
import { type BaseInstructionParams } from "./instructionParams";
import { type StakeSignature } from "../signing";

/**
 * Accounts and per-tx parameters shared by both `stake` variants. Auth-related fields
 * (signature, expiry, state_nonce) live on the variant-specific input types.
 */
export interface StakeBaseParams extends BaseInstructionParams {
  payer: TransactionSigner;
  market: Address;
  /** PDA of the stake_account being staked into. Use `getStakeAccountAddress(owner, market, id)`. */
  stakeAccount: Address;
  stakeAccountId: number;
  tokenMint: Address;
  marketTokenAta: Address;
  tokenProgram: Address;
  amount: bigint;
  selectedOptionCiphertext: ByteArray;
  inputNonce: bigint;
  authorizedReaderNonce: bigint;
  /** User's x25519 public key (NOT their Solana wallet pubkey). */
  userPubkey: ByteArray;
}

/**
 * Inputs for a stake call where the `payer` is also the stake_account.owner.
 * The on-chain code's owner==payer shortcut skips ed25519 verification, so no
 * pre-signed message is needed; the signature/expiry fields are zeroed.
 */
export interface StakeAsOwnerParams extends StakeBaseParams {
  /** u128 nonce committed to encrypted-state derivation. */
  stateNonce: bigint;
}

/**
 * Inputs for a stake call where the `payer` is a third party (the stake_delegate authority).
 * The owner has pre-signed the canonical stake message off-chain; pass that branded
 * {@link StakeSignature} here. `stateNonce`, expiry, and other auth fields are pulled from
 * the signature payload — caller doesn't repeat them.
 */
export interface StakeAsDelegateParams extends StakeBaseParams {
  /** The owner's authorization, produced via `signStakeMessage`. */
  signature: StakeSignature;
}

const ZERO_SIGNATURE: number[] = new Array(64).fill(0);

/**
 * Build a stake instruction where the transaction signer is the stake_account.owner.
 * No off-chain ed25519 signature is required — the on-chain code skips verification
 * via the owner==payer shortcut.
 */
export async function stakeAsOwner(
  input: StakeAsOwnerParams,
  config: ArciumConfig,
): Promise<StakeInstruction<string>> {
  const {
    programAddress,
    payer,
    market,
    stakeAccount,
    stakeAccountId,
    tokenMint,
    marketTokenAta,
    tokenProgram,
    amount,
    selectedOptionCiphertext,
    inputNonce,
    authorizedReaderNonce,
    userPubkey,
    stateNonce,
  } = input;

  return getStakeInstructionAsync(
    {
      ...getComputeAccounts("stake", config),
      payer,
      market,
      stakeAccount,
      stakeAccountId,
      tokenMint,
      marketTokenAta,
      tokenProgram,
      amount,
      selectedOptionCiphertext: toNumberArray(selectedOptionCiphertext),
      inputNonce,
      authorizedReaderNonce,
      userPubkey: toNumberArray(userPubkey),
      stateNonce,
      signatureExpiryTimestamp: 0n,
      ownerSignature: ZERO_SIGNATURE,
    },
    programAddress ? { programAddress } : undefined,
  );
}

/**
 * Build a stake instruction where the transaction signer is the stake_delegate.authority,
 * NOT the stake_account.owner. Requires a {@link StakeSignature} produced by the owner
 * off-chain. State nonce, expiry, and the canonical inputs are pulled from the signature
 * payload to guarantee what's submitted on-chain matches what was signed.
 */
export async function stakeAsDelegate(
  input: StakeAsDelegateParams,
  config: ArciumConfig,
): Promise<StakeInstruction<string>> {
  const {
    programAddress,
    payer,
    market,
    stakeAccount,
    stakeAccountId,
    tokenMint,
    marketTokenAta,
    tokenProgram,
    amount,
    signature,
  } = input;

  const { payload } = signature;

  return getStakeInstructionAsync(
    {
      ...getComputeAccounts("stake", config),
      payer,
      market,
      stakeAccount,
      stakeAccountId,
      tokenMint,
      marketTokenAta,
      tokenProgram,
      amount,
      selectedOptionCiphertext: toNumberArray(payload.selectedOptionCiphertext),
      inputNonce: payload.inputNonce,
      authorizedReaderNonce: payload.authorizedReaderNonce,
      userPubkey: toNumberArray(payload.userPubkey),
      stateNonce: payload.stateNonce,
      signatureExpiryTimestamp: payload.signatureExpiryTimestamp,
      ownerSignature: toNumberArray(signature.signature),
    },
    programAddress ? { programAddress } : undefined,
  );
}
