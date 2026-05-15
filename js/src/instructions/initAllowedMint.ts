import { type TransactionSigner, type Address } from "@solana/kit";
import {
  getInitAllowedMintInstructionAsync,
  type InitAllowedMintInstruction,
} from "../generated";
import { type BaseInstructionParams } from "./instructionParams";

export interface InitAllowedMintParams extends BaseInstructionParams {
  updateAuthority: TransactionSigner;
  platformConfig: Address;
  tokenMint: Address;
}

export async function initAllowedMint(
  input: InitAllowedMintParams,
): Promise<InitAllowedMintInstruction<string>> {
  const { programAddress, ...params } = input;
  return getInitAllowedMintInstructionAsync(
    params,
    programAddress ? { programAddress } : undefined,
  );
}
