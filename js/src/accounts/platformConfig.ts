import {
  type Address,
  getAddressEncoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const PLATFORM_CONFIG_SEED = "platform_config";

export async function getPlatformConfigAddress(
  authority: Address,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS,
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [PLATFORM_CONFIG_SEED, getAddressEncoder().encode(authority)],
  });
}
