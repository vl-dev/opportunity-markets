import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getFinalizeRevealStakeInstructionAsync,
  type FinalizeRevealStakeInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface FinalizeRevealStakeParams extends BaseInstructionParams {
  signer: TransactionSigner;
  owner: Address;
  market: Address;
  optionId: number | bigint;
  stakeAccountId: number;
}

export async function finalizeRevealStake(
  input: FinalizeRevealStakeParams
): Promise<FinalizeRevealStakeInstruction<string>> {
  const { programAddress, ...params } = input;
  return getFinalizeRevealStakeInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
