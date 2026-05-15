import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getClaimCreatorFeesInstructionAsync,
  type ClaimCreatorFeesInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface ClaimCreatorFeesParams extends BaseInstructionParams {
  signer: TransactionSigner;
  market: Address;
  tokenMint: Address;
  destinationTokenAccount: Address;
  tokenProgram: Address;
}

export async function claimCreatorFees(
  input: ClaimCreatorFeesParams
): Promise<ClaimCreatorFeesInstruction<string>> {
  const { programAddress, ...params } = input;
  return getClaimCreatorFeesInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
