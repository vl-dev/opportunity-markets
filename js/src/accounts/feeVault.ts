import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const FEE_VAULT_SEED = "fee_vault";

export async function getFeeVaultAddress(
  mint: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [FEE_VAULT_SEED, getAddressEncoder().encode(mint)],
  });
}
