import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getProposeNewFeeClaimAuthorityInstructionAsync,
  type ProposeNewFeeClaimAuthorityInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface ProposeNewFeeClaimAuthorityParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  platformConfig: Address;
  proposedFeeClaimAuthority: Address;
}

export async function proposeNewFeeClaimAuthority(
  input: ProposeNewFeeClaimAuthorityParams,
): Promise<ProposeNewFeeClaimAuthorityInstruction<string>> {
  const { programAddress, ...params } = input;
  return getProposeNewFeeClaimAuthorityInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
