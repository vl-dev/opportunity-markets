import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getFinalizeNewFeeClaimAuthorityInstructionAsync,
  type FinalizeNewFeeClaimAuthorityInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface FinalizeNewFeeClaimAuthorityParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  proposedFeeClaimAuthority: TransactionSigner;
  platformConfig: Address;
}

export async function finalizeNewFeeClaimAuthority(
  input: FinalizeNewFeeClaimAuthorityParams,
): Promise<FinalizeNewFeeClaimAuthorityInstruction<string>> {
  const { programAddress, ...params } = input;
  return getFinalizeNewFeeClaimAuthorityInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
