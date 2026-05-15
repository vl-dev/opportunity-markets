import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getClaimFeesInstructionAsync,
  type ClaimFeesInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface ClaimFeesParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  platformConfig: Address;
  tokenMint: Address;
  destinationTokenAccount: Address;
  tokenProgram: Address;
}

export async function claimFees(
  input: ClaimFeesParams
): Promise<ClaimFeesInstruction<string>> {
  const { programAddress, ...params } = input;
  return getClaimFeesInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
