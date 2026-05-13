import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getCancelFeeClaimAuthorityChangeInstructionAsync,
  type CancelFeeClaimAuthorityChangeInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface CancelFeeClaimAuthorityChangeParams extends BaseInstructionParams {
  signer: TransactionSigner;
  platformConfig: Address;
}

export async function cancelFeeClaimAuthorityChange(
  input: CancelFeeClaimAuthorityChangeParams,
): Promise<CancelFeeClaimAuthorityChangeInstruction<string>> {
  const { programAddress, ...params } = input;
  return getCancelFeeClaimAuthorityChangeInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
