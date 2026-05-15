import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const ALLOWED_MINT_SEED = "allowed_mint";

export async function getAllowedMintAddress(
  platformConfig: Address,
  mint: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS,
): Promise<ProgramDerivedAddress> {
  const enc = getAddressEncoder();
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [ALLOWED_MINT_SEED, enc.encode(platformConfig), enc.encode(mint)],
  });
}
