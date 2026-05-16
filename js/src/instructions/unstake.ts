import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getUnstakeInstructionAsync,
  type UnstakeInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface UnstakeParams extends BaseInstructionParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  tokenMint: Address;
  ownerTokenAccount: Address;
  tokenProgram: Address;
  stakeAccountId: number;
}

export async function unstake(
  input: UnstakeParams,
): Promise<UnstakeInstruction<string>> {
  const { programAddress, ...params } = input;

  return getUnstakeInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
