import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getFinalizeNewUpdateAuthorityInstructionAsync,
  type FinalizeNewUpdateAuthorityInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface FinalizeNewUpdateAuthorityParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  proposedAuthority: TransactionSigner;
  platformConfig: Address;
}

export async function finalizeNewUpdateAuthority(
  input: FinalizeNewUpdateAuthorityParams,
): Promise<FinalizeNewUpdateAuthorityInstruction<string>> {
  const { programAddress, ...params } = input;
  return getFinalizeNewUpdateAuthorityInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
