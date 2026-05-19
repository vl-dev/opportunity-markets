import {
  type Address,
  getAddressEncoder,
  getU64Encoder,
  getProgramDerivedAddress,
  type ProgramDerivedAddress,
} from "@solana/kit";
import { OPPORTUNITY_MARKET_PROGRAM_ADDRESS } from "../generated";

export const OPPORTUNITY_MARKET_SEED = "opportunity_market";

export async function getOpportunityMarketAddress(
  platformConfig: Address,
  creator: Address,
  marketIndex: bigint | number,
  programId: Address = OPPORTUNITY_MARKET_PROGRAM_ADDRESS
): Promise<ProgramDerivedAddress> {
  return getProgramDerivedAddress({
    programAddress: programId,
    seeds: [
      OPPORTUNITY_MARKET_SEED,
      getAddressEncoder().encode(platformConfig),
      getAddressEncoder().encode(creator),
      getU64Encoder().encode(BigInt(marketIndex)),
    ],
  });
}
