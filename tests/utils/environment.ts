import {
  getMXEPublicKey,
} from "@arcium-hq/client";
import {
  KeyPairSigner,
  Address,
  generateKeyPairSigner,
  airdropFactory,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  lamports,
  pipe,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstructions,
  signTransactionMessageWithSigners,
  sendAndConfirmTransactionFactory,
  getBase64EncodedWireTransaction,
  assertIsTransactionWithBlockhashLifetime,
} from "@solana/kit";
import {
  OpportunityMarket,
  OpportunityMarketOption,
  createMarket,
  fetchOpportunityMarket,
  getInitPlatformConfigInstructionAsync,
  getInitAllowedMintInstructionAsync,
  getPlatformConfigAddress,
  getOpportunityMarketAddress,
} from "../../js/src";
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import { generateX25519Keypair, X25519Keypair } from "../../js/src/x25519/keypair";
import { createTokenMint, createAta, mintTokensTo, TOKEN_PROGRAM_ADDRESS } from "./spl-token";

export interface Account {
  keypair: KeyPairSigner;
  x25519Keypair: X25519Keypair;
  initialAirdroppedLamports: bigint;
  tokenAccount: Address;
}

export interface AccountWithETA extends Account {
  encryptedTokenAccount: Address;
}

export type WithAddress<T> = T & {
  address: Address;
};

export interface TestEnvironment {
  market: WithAddress<OpportunityMarket> & {
    creatorAccount: Account;
    options: WithAddress<OpportunityMarketOption>[];
    timeToReveal: bigint;
  };
  participants: Account[];
  mxePublicKey: Uint8Array;
  mint: KeyPairSigner;
  tokenProgram: Address;
  rpc: ReturnType<typeof createSolanaRpc>;
  rpcSubscriptions: ReturnType<typeof createSolanaRpcSubscriptions>;
}

export interface CreateTestEnvironmentConfig {
  rpcUrl?: string;
  wsUrl?: string;
  numParticipants?: number;
  airdropLamports?: bigint;
  initialTokenAmount?: bigint;
  marketConfig?: {
    rewardAmount?: bigint;
    timeToStake?: bigint;
    timeToReveal?: bigint;
    unstakeDelaySeconds?: bigint;
  };
}

const DEFAULT_CONFIG: Required<CreateTestEnvironmentConfig> = {
  rpcUrl: "http://127.0.0.1:8899",
  wsUrl: "ws://127.0.0.1:8900",
  numParticipants: 5,
  airdropLamports: 2_000_000_000n,
  initialTokenAmount: 1_000_000_000n,
  marketConfig: {
    rewardAmount: 1_000_000_000n,
    timeToStake: 120n,
    timeToReveal: 60n,
    unstakeDelaySeconds: 10n,
  },
};

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: anchor.web3.PublicKey,
  maxRetries: number = 20,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(`Failed to fetch MXE public key after ${maxRetries} attempts`);
}

async function createAccount(): Promise<Omit<Account, "initialAirdroppedLamports" | "tokenAccount">> {
  const keypair = await generateKeyPairSigner();
  const x25519Keypair = generateX25519Keypair();
  return { keypair, x25519Keypair };
}

export async function createTestEnvironment(
  provider: anchor.AnchorProvider,
  programId: Address,
  config: CreateTestEnvironmentConfig = {}
): Promise<TestEnvironment> {
  const mergedConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    marketConfig: { ...DEFAULT_CONFIG.marketConfig, ...config.marketConfig },
  };

  const { rpcUrl, wsUrl, numParticipants, airdropLamports, initialTokenAmount, marketConfig } = mergedConfig;

  const rpc = createSolanaRpc(rpcUrl);
  const rpcSubscriptions = createSolanaRpcSubscriptions(wsUrl);
  const airdrop = airdropFactory({ rpc, rpcSubscriptions });
  const sendAndConfirmTransaction = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

  const programIdLegacy = new PublicKey(programId);
  const mxePublicKey = await getMXEPublicKeyWithRetry(provider, programIdLegacy);

  const accountPromises = Array.from({ length: numParticipants + 1 }, () =>
    createAccount()
  );
  const accounts = await Promise.all(accountPromises);

  const creatorAccountBase = accounts[numParticipants];

  console.log(`\nAirdropping ${Number(airdropLamports) / 1_000_000_000} SOL to all accounts...`);
  const airdropPromises = accounts.map((account) =>
    airdrop({
      recipientAddress: account.keypair.address,
      lamports: lamports(airdropLamports),
      commitment: "confirmed",
    })
  );
  await Promise.all(airdropPromises);

  console.log("\nCreating SPL token mint...");
  const mint = await createTokenMint(
    rpc,
    sendAndConfirmTransaction,
    creatorAccountBase.keypair,
    creatorAccountBase.keypair.address
  );
  console.log(`  Mint created: ${mint.address}`);

  console.log("\nCreating ATAs and minting tokens...");
  const accountsWithTokens: Array<{
    keypair: KeyPairSigner;
    x25519Keypair: X25519Keypair;
    tokenAccount: Address;
  }> = [];

  for (const account of accounts) {
    const ata = await createAta(
      rpc,
      sendAndConfirmTransaction,
      creatorAccountBase.keypair,
      mint.address,
      account.keypair.address
    );
    await mintTokensTo(
      rpc,
      sendAndConfirmTransaction,
      creatorAccountBase.keypair,
      mint.address,
      ata,
      initialTokenAmount
    );
    accountsWithTokens.push({
      keypair: account.keypair,
      x25519Keypair: account.x25519Keypair,
      tokenAccount: ata,
    });
  }

  const participantsWithTokens = accountsWithTokens.slice(0, numParticipants);
  const creatorAccountWithTokens = accountsWithTokens[numParticipants];

  const participants: Account[] = participantsWithTokens.map((account) => ({
    ...account,
    initialAirdroppedLamports: airdropLamports,
  }));

  const creatorAccount: Account = {
    ...creatorAccountWithTokens,
    initialAirdroppedLamports: airdropLamports,
  };

  const initPlatformConfigIx = await getInitPlatformConfigInstructionAsync({
    payer: creatorAccount.keypair,
    platformFeeBp: 0,
    rewardPoolFeeBp: 0,
    feeClaimAuthority: creatorAccount.keypair.address,
    minTimeToStakeSeconds: 1n,
    minTimeToRevealSeconds: 1n,
  });

  const [platformConfigAddress] = await getPlatformConfigAddress(
    creatorAccount.keypair.address,
    programId,
  );

  const initAllowedMintIx = await getInitAllowedMintInstructionAsync({
    updateAuthority: creatorAccount.keypair,
    platformConfig: platformConfigAddress,
    tokenMint: mint.address,
  });

  const { value: csBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const csTxMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(creatorAccount.keypair.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(csBlockhash, msg),
    (msg) => appendTransactionMessageInstructions([initPlatformConfigIx, initAllowedMintIx], msg)
  );
  const csSignedTx = await signTransactionMessageWithSigners(csTxMessage);
  assertIsTransactionWithBlockhashLifetime(csSignedTx);
  await sendAndConfirmTransaction(csSignedTx, { commitment: "confirmed" });
  console.log("  Platform config + allowed mint initialized");

  const marketIndex = BigInt(Math.floor(Math.random() * 1000000));

  const createMarketIx = await createMarket({
    creator: creatorAccount.keypair,
    platformConfig: platformConfigAddress,
    tokenMint: mint.address,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    marketIndex,
    timeToStake: marketConfig.timeToStake,
    timeToReveal: marketConfig.timeToReveal,
    marketAuthority: creatorAccount.keypair.address,
    unstakeDelaySeconds: marketConfig.unstakeDelaySeconds,
    authorizedReaderPubkey: creatorAccount.x25519Keypair.publicKey,
    allowClosingEarly: true,
    revealPeriodAuthority: creatorAccount.keypair.address,
    earlinessCutoffSeconds: 0n,
    minStakeAmount: 0n,
  });

  const { value: latestBlockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();

  const transactionMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (msg) => setTransactionMessageFeePayer(creatorAccount.keypair.address, msg),
    (msg) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, msg),
    (msg) => appendTransactionMessageInstructions([createMarketIx], msg)
  );

  const signedTransaction = await signTransactionMessageWithSigners(transactionMessage);

  const base64Tx = getBase64EncodedWireTransaction(signedTransaction);
  const simResult = await rpc.simulateTransaction(base64Tx, {
    commitment: "confirmed",
    encoding: "base64",
  }).send();


  if (simResult.value.err) {
    console.log("  Simulation failed:");
    console.log("    Error:", simResult.value.err);
    console.log("    Logs:");
    simResult.value.logs?.forEach((log) => console.log("      ", log));
    throw new Error(`Simulation failed: ${JSON.stringify(simResult.value.err)}`);
  }

  assertIsTransactionWithBlockhashLifetime(signedTransaction);
  await sendAndConfirmTransaction(signedTransaction, { commitment: "confirmed" });
  const [marketAddress] = await getOpportunityMarketAddress(
    creatorAccount.keypair.address,
    marketIndex,
    programId,
  );
  const marketAccount = await fetchOpportunityMarket(rpc, marketAddress, { commitment: "confirmed" });

  return {
    market: {
      ...marketAccount.data,
      address: marketAddress,
      creatorAccount,
      options: [],
      timeToReveal: marketConfig.timeToReveal,
    },
    participants,
    mxePublicKey,
    mint,
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
    rpc,
    rpcSubscriptions,
  };
}
