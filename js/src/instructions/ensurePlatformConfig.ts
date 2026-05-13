import { type TransactionSigner, type Address, type Instruction } from "@solana/kit";
import {
  fetchMaybePlatformConfig,
  getInitPlatformConfigInstructionAsync,
  getUpdatePlatformConfigInstruction,
} from "../generated";
import { getPlatformConfigAddress } from "../accounts/platformConfig";
import { type BaseInstructionParams } from "./instructionParams";

export interface EnsurePlatformConfigParams extends BaseInstructionParams {
  signer: TransactionSigner;
  platformFeeBp: number;
  rewardPoolFeeBp: number;
  feeClaimAuthority: Address;
  minTimeToStakeSeconds: bigint;
  minTimeToRevealSeconds: bigint;
}

export async function ensurePlatformConfig(
  rpc: Parameters<typeof fetchMaybePlatformConfig>[0],
  params: EnsurePlatformConfigParams,
): Promise<Instruction | null> {
  const {
    programAddress,
    signer,
    platformFeeBp,
    rewardPoolFeeBp,
    feeClaimAuthority,
    minTimeToStakeSeconds,
    minTimeToRevealSeconds,
  } = params;
  const config = programAddress ? { programAddress } : undefined;

  const [platformConfigAddress] = await getPlatformConfigAddress(
    signer.address,
    programAddress,
  );
  const existing = await fetchMaybePlatformConfig(rpc, platformConfigAddress);

  if (existing.exists) {
    const s = existing.data;
    if (
      s.platformFeeBp === platformFeeBp &&
      s.rewardPoolFeeBp === rewardPoolFeeBp &&
      s.minTimeToStakeSeconds === minTimeToStakeSeconds &&
      s.minTimeToRevealSeconds === minTimeToRevealSeconds
    ) {
      return null;
    }

    return getUpdatePlatformConfigInstruction(
      {
        updateAuthority: signer,
        platformConfig: platformConfigAddress,
        platformFeeBp,
        rewardPoolFeeBp,
        minTimeToStakeSeconds,
        minTimeToRevealSeconds,
      },
      config,
    ) as Instruction;
  }

  return getInitPlatformConfigInstructionAsync(
    {
      payer: signer,
      platformFeeBp,
      rewardPoolFeeBp,
      feeClaimAuthority,
      minTimeToStakeSeconds,
      minTimeToRevealSeconds,
    },
    config,
  ) as Promise<Instruction>;
}
