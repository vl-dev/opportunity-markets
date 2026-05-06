import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitFeeVaultInstructionAsync,
  type InitFeeVaultInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitFeeVaultParams extends BaseInstructionParams {
  payer: TransactionSigner;
  tokenMint: Address;
  tokenProgram: Address;
}

export async function initFeeVault(
  input: InitFeeVaultParams
): Promise<InitFeeVaultInstruction<string>> {
  const { programAddress, ...params } = input;
  return getInitFeeVaultInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined
  );
}
