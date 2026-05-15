# VulnHunter Security Audit — opportunity_market

**Scope:** Anchor program `programs/opportunity_market/` (≈3,800 LoC across 31 instruction handlers, state, error, events, score) and the Arcium-encrypted circuit `encrypted-ixs/src/lib.rs`.
**Out of scope:** JS client (`js/`), tests, off-chain Arcium MPC nodes (trusted infra), `arcium-anchor` / `arcium-client` crates.
**Methodology:** Sharp-edges scan over every instruction handler + variant hunt on the top issues (callback races, fee/reward accounting, account validation, Token-2022 surface).
**Branch reviewed:** `permissionless-design` @ `b0484c5`.
**Threat model from `docs/security/README.md`:** staked SPL tokens must always be recoverable; rewards must follow protocol rules; Arcium callbacks may be delayed or fail, so every in-flight state must be reachable from an escape hatch.

---

## Executive summary

| Severity | Count | Fixed |
|---|---|---|
| Critical | 1 | 1 |
| High     | 3 | 3 |
| Medium   | 5 | 0 |
| Low / Informational | 7 | 1 |

**Fixed:** C1, H1, H2, H3, L3.
**Outstanding:** M1, M2, M3, M4, L1, L2, L4, L5, L6, L7.

**Top recommendations:**

1. **Bind every Arcium callback to a specific in-flight computation**, not just to a boolean `pending_*` flag — a delayed `stake` callback can land on a re-initialized stake account and silently overwrite the user's vote (C1).
2. **Restrict allowed mints to "safe" SPL / Token-2022 configurations.** Permanent Delegate, Transfer Hook, Transfer Fee, Pausable, Confidential Transfer, and Non-Transferable extensions break the program's accounting and trust assumptions (H1).
3. **Provide a post-expiry recovery path for sponsor deposits.** If `market_authority` fails to call `resolve_market` before the deadline, every sponsor's funds — locked or not — become unreachable (H2, H3).

The protocol is otherwise carefully written: PDA seeds bind cross-account relationships, fee math uses checked u128 arithmetic, authority changes are timelocked + two-party, and there is no synchronous CPI re-entrancy surface.

---

## Reconnaissance

### Trust boundaries

| Principal | Where set | Privilege |
|---|---|---|
| `platform_config.update_authority` | `init_platform_config` payer; rotatable via 48 h timelock + co-signature | Update fee BPs, time bounds, deadline; whitelist mints |
| `platform_config.fee_claim_authority` | `init_platform_config` arg; rotatable via timelock | Claim accumulated `collected_platform_fees` |
| `market.creator` | `create_market` signer (PDA seed) | Open the market; receive close rent |
| `market.market_authority` | `create_market` arg | Pause/resume staking; pick & resolve winners |
| `market.reveal_period_authority` | `create_market` arg | Call `end_reveal_period` once past `min_reveal_period_seconds` |
| `market.market_fee_claimer` | `create_market` arg | Claim `collected_creator_fees` once resolved |
| `market.authorized_reader_pubkey` | `create_market` arg | x25519 key that receives off-chain disclosure ciphertexts |
| Stake-account owner | `init_stake_account` arg (UncheckedAccount, no sig) — owner is fixed in PDA seed | Sign `stake`, `unstake_early`; receive close rent and refunds |
| Anyone | `init_stake_account`, `reveal_stake`, `do_unstake_early`, `increment_option_tally` | Permissionless callers (operator-paid UX) |

### State machine

```
OpportunityMarket: (open_timestamp=None)
  ── open_market ──▶ open (open_timestamp = future)
  ── stake period: [open_timestamp, open_timestamp + time_to_stake] ──▶
     stake/unstake_early/do_unstake_early/add_reward/withdraw_reward/pause/resume
  ── (allow_closing_early ? any time after open : after stake_end) ──▶
     set_winning_option …  ─▶ resolve_market  (resolved = true; time_to_stake may shrink)
                                       │
                                       ▼ reveal period (lasts ≥ min_reveal_period_seconds)
     reveal_stake / increment_option_tally
                                       │
                                       ▼ end_reveal_period (reveal_ended_at = Some)
     close_stake_account (resolved path)

  ── current_timestamp ≥ stake_end + market_resolution_deadline_seconds and not resolved ──▶
     EXPIRED.  reclaim_stake refunds amount; close_stake_account refunds reward_pool_fee + creator_fee.
```

### Sharp-edges quick scan

- `unwrap_or(stake_end)` / `unwrap_or(0)` in event emission only — never in money paths ✓
- Token transfers go through `transfer_checked` with mint + decimals ✓
- All `u64`/`u128` arithmetic on user-controlled inputs uses `checked_*` ✓
- No `tx.origin`-style auth surrogates; all auth is `Signer<'info>` + `has_one` / explicit constraint ✓
- No raw `pickle`/`yaml`/`exec` equivalents; no FFI/unsafe blocks ✓
- `init_if_needed` only used for the fixed-address `sign_pda_account` and per-(sponsor,market) `OpportunityMarketSponsor` ✓
- No same-program CPI; SPL/Arcium are the only CPI targets ✓

---

## Findings

### [C1] Critical — `stake_callback` race after `close_stuck_stake_account` + re-init + re-stake corrupts the user's vote

**Status: FIXED.** `StakeAccount` now carries `pending_stake_computation: Option<Pubkey>` (the bool `pending_stake` was subsumed). `stake()` stores `computation_account.key()`; `stake_callback` requires the stored pubkey equals the callback's `computation_account`, then clears it. `close_stuck_stake_account` gates on `pending_stake_computation.is_some()`. A stale callback from a closed-then-reborn-then-re-staked account hits a different `computation_account` and fails the equality check.

**Location:** `programs/opportunity_market/src/instructions/stake.rs:251-320` and `close_stuck_stake_account.rs:56-115`.

**Pattern abstraction:**
`async_request → boolean_in_flight_flag → async_callback (no per-request binding)`
Identical to TOCTOU around Solana close/reinit. Same as the "stale callback to reinitialized PDA" pattern; documented inside the codebase as a *partial* concern in `docs/security/README.md` ("Example of this escape hatch implementation is the `close_stuck_stake_account` instruction for the case that the callback of the `stake` instruction fails to run.").

**Sequence that breaks the assumption** (the in-source comment at `stake.rs:266-269` says *"A late callback delivered after close_stuck + re-init would see pending_stake=false"* — this is only true if the user does not re-stake before the stale callback arrives):

1. User stakes vote A. `stake_account` set: `locked=true, pending_stake=true, encrypted_option=<empty>`. Computation Q1 queued; tokens transferred.
2. Q1's callback is delayed beyond the user's patience (the security README explicitly accepts this scenario: *"the callback never comes"*).
3. User calls `close_stuck_stake_account` (line 63 requires `pending_stake`, which is true). Tokens refunded, account closed.
4. User calls `init_stake_account` — PDA is reborn fresh (`pending_stake=false`, all-zero).
5. User calls `stake` again with vote B. `stake_account: pending_stake=true, locked=true`. Computation Q2 queued.
6. **Q1's callback finally lands.** `stake_callback` only checks `require!(stake_account.pending_stake)` — true (from step 5). The check passes. The handler then writes:
   - `state_nonce = Q1.mxe_nonce`
   - `encrypted_option = Q1.ciphertexts[0]`           ← vote A
   - `encrypted_option_disclosure = Q1.shared.ciphertexts[0]`
   - `market.collected_platform_fees += stake_account.platform_fee`   (the Q2-stake fee value)
   - `pending_stake = false; locked = false`
7. Q2's callback eventually lands. `pending_stake` is now `false`. The require! fails. Q2's encryption is discarded.

**Result:** The user holds vote A's MPC ciphertext under Q2's stake economics. `reveal_stake` decrypts to A. The user paid for B but is recorded as A. There is no on-chain detection of the divergence — `state_nonce` and `encrypted_option` are mutually consistent (both from Q1) and the MPC reveal succeeds.

**Why the docstring mitigation is insufficient:** The security README and inline comment both assume the user *will not re-stake* before the stale callback arrives. There is no enforcement of that assumption — and the natural UX is "stake failed, retry."

**Severity rationale — Critical:**
- Direct corruption of user intent in a vote-encrypting protocol whose entire value proposition is private, accurate vote recording.
- Triggerable from normal user flow when Arcium callbacks are slow; does not require an attacker.
- Silent: nothing on-chain or in events distinguishes the corrupted state from a normal stake.
- Generalizes: any future Arcium computation that writes to a closeable account will inherit the same race.

**Remediation:**
```rust
// state.rs — bind the in-flight computation to the account
#[account]
#[derive(InitSpace)]
pub struct StakeAccount {
    ...
    pub pending_stake_offset: Option<u64>,   // computation_offset queued
    ...
}

// stake.rs
ctx.accounts.stake_account.pending_stake_offset = Some(computation_offset);

// stake_callback — derive the expected comp PDA from the stored offset
// and require!(ctx.accounts.computation_account.key() == expected).
require!(
    ctx.accounts.stake_account.pending_stake_offset == Some(callback_offset),
    ErrorCode::InvalidAccountState,
);
```
Equivalent fixes: store the `computation_account` pubkey itself; store a per-account `epoch: u32` and include it as a plaintext input to the circuit so the callback can authenticate it. Whichever shape you choose, the principle is the same: the callback must prove it belongs to *this* queued computation, not just to *some* in-flight computation on this account.

**Variant search:**
- `reveal_stake_callback` (reveal_stake.rs:149-188) follows the same shape but is **safer in practice**: (a) reveal is deterministic, so a late reveal callback produces the same plaintext as a fresh one; (b) `revealed_option.is_none()` is also checked; (c) there is no close-and-reinit instruction for revealed accounts, so the account address cannot be reused. **No replay corruption,** but the *defense-in-depth* recommendation still applies: bind the callback to its computation.

---

### [H1] High — `init_allowed_mint` accepts any SPL / Token-2022 mint; dangerous extensions can drain funds or break accounting

**Status: FIXED.** `init_allowed_mint` now unpacks the mint with `spl_token_2022::extension::StateWithExtensions` and rejects mints whose extension list intersects `FORBIDDEN_MINT_EXTENSIONS` (TransferFeeConfig, PermanentDelegate, TransferHook, NonTransferable, Pausable, DefaultAccountState, ConfidentialTransferMint, ConfidentialTransferFeeConfig, ConfidentialMintBurn, InterestBearingConfig, ScaledUiAmount, MintCloseAuthority). Classic SPL Token mints have no extensions and pass trivially.

**Location:** `programs/opportunity_market/src/instructions/init_allowed_mint.rs:11-32`.

The program uses `Interface<TokenInterface>` everywhere, which supports both classic SPL Token and Token-2022. `init_allowed_mint` performs no validation on the mint's extensions. The market ATA balance is the protocol's only ledger; the program assumes every `transfer_checked` of `amount` moves exactly `amount`. The following Token-2022 extensions violate that assumption:

| Extension | Failure mode |
|---|---|
| **Permanent Delegate** | The mint authority's delegate can call `transfer_checked` on `market_token_ata` at any time, draining stakes, fees, and rewards. Direct loss-of-funds. |
| **Transfer Fee** | Each `transfer_checked(amount)` only credits `amount – withheld_fee` to the destination. After many stakes, `market_token_ata.amount` < sum of recorded `stake_account.amount`. Final stakers/sponsors/fee claimants get partial refunds; one party gets nothing. |
| **Transfer Hook** | A custom program is CPI'd on every transfer. The hook can fail (DoS the market entirely) or invoke arbitrary instructions with the market's transient privileges. |
| **Non-Transferable** | `add_reward` and `stake` transfers succeed (mint authority is exempt) but `reclaim_stake` / `claim_fees` / `withdraw_reward` fail forever. All funds stuck. |
| **Pausable** | Mint authority can pause the token mid-market, freezing reclaims/claims. Soft loss-of-funds. |
| **Confidential transfer** | Confidential balances are not visible to the program; the program would believe `market_token_ata.amount == 0` while real value sits in the confidential extension. |
| **Default Account State = Frozen** | Newly created `market_token_ata` may be frozen on init, blocking the very first `transfer_checked`. |

**Severity rationale:** Loss-of-funds severity for any of the above; the protocol's gate against malicious mints is a single `update_authority` whitelist call with no programmatic checks. The whitelist is intentional, but a typo or a benign-looking mint with a delegate is an instant drain.

**Remediation (in `init_allowed_mint`):**
```rust
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, StateWithExtensions, ExtensionType,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as Token22Mint;

let mint_info = ctx.accounts.token_mint.to_account_info();
let data = mint_info.try_borrow_data()?;
let mint = StateWithExtensions::<Token22Mint>::unpack(&data)?;

const FORBIDDEN: &[ExtensionType] = &[
    ExtensionType::TransferFeeConfig,
    ExtensionType::PermanentDelegate,
    ExtensionType::TransferHook,
    ExtensionType::NonTransferable,
    ExtensionType::MintCloseAuthority,        // optional; defensive
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::Pausable,
    ExtensionType::DefaultAccountState,
];
for ext in mint.get_extension_types()? {
    require!(!FORBIDDEN.contains(&ext), ErrorCode::InvalidMint);
}
```
Alternative: restrict to the classic SPL Token program by ID, but this loses Token-2022 entirely.

**Variant search:** every instruction that touches `market_token_ata` inherits this risk — `stake`, `reclaim_stake`, `do_unstake_early`, `close_stuck_stake_account`, `close_stake_account`, `add_reward`, `withdraw_reward`, `claim_fees`, `claim_creator_fees`. A single gatekeeper at `init_allowed_mint` is the right place to fix it.

---

### [H2] High — Sponsor's `lock=true` deposit is unrecoverable when the market expires

**Status: FIXED.** `withdraw_reward` now allows recovery once `current_timestamp >= stake_end + market_resolution_deadline_seconds && !market.resolved`, regardless of `reward_locked`. Locked sponsors can recover their full `reward_deposited` from an expired-without-resolution market. The `market.reward_amount.checked_sub` is safe under any interleaving with stakers' expired-path closes because each actor is capped by their own tracked contribution.

**Location:** `programs/opportunity_market/src/instructions/withdraw_reward.rs:53-114`, `add_reward.rs:55-117`, `close_stake_account.rs:67-118`.

Per the security README: *"Market sponsors should be able to deposit a market reward (can choose either permanently locked or withdrawable), and trust that after the market is resolved, the reward is split according to the rules of the protocol."*

The implementation does not honor the "after the market is resolved" guarantee in the **expired** branch. Walk-through:

1. Sponsor calls `add_reward(amount=X, lock=true)`. `market.reward_amount = X`. `sponsor_account.reward_locked = true`.
2. Stakers stake, accumulating `Y` of `reward_pool_fee`. `market.reward_amount = X + Y`.
3. `market_authority` fails to call `resolve_market` before `stake_end + market_resolution_deadline_seconds`.
4. Stakers call `reclaim_stake` (returns their net amounts) and then `close_stake_account` on the **expired** path. Each call subtracts that staker's `reward_pool_fee` from `market.reward_amount`. After all stakers exit: `market.reward_amount = X`.
5. The sponsor cannot call `withdraw_reward` — it requires `!sponsor_account.reward_locked` (line 57).
6. No other instruction can move funds out of `market_token_ata` once stake_end is past and the market is unresolved. **X is locked forever.**

**Severity rationale:** Direct loss-of-funds for a sponsor obeying the *documented* contract. The promise was conditional on resolution; the failure mode (no resolution) has no escape hatch.

**Remediation:** Allow `withdraw_reward` on expired markets even when `reward_locked` is true, *but only refunding `market.reward_amount`-minus-pending-staker-fees back to the original depositor.* A clean shape:
```rust
// withdraw_reward — extra branch
if let Some(open_ts) = market.open_timestamp {
    let stake_end = open_ts.checked_add(market.time_to_stake)?;
    let expired_at = stake_end.checked_add(market.market_resolution_deadline_seconds)?;
    if current_ts >= expired_at && !market.resolved {
        // expired branch — allow recovery
    } else {
        require!(current_ts < stake_end, TimeWindowMismatch);
        require!(!sponsor_account.reward_locked, Unauthorized);
    }
}
```
Note: stakers must close on the expired path first so the `reward_pool_fee` portion is subtracted out, otherwise the sponsor would over-withdraw. Two clean options:
- Only allow expired-sponsor recovery after all stake accounts are closed.
- Or, track sponsor-deposited vs staker-fee components separately on the market (`market.sponsored_amount` distinct from `market.staker_reward_pool`).

---

### [H3] High — Sponsor's `lock=false` deposit is unrecoverable if not withdrawn before stake_end AND market expires

**Status: FIXED.** Same `withdraw_reward` change as H2: post-expiry recovery is available to any sponsor (locked or not) once `!market.resolved`. The pre-stake-end recovery path for unlocked sponsors is preserved. Covered end-to-end by the test `expired market lets sponsors recover their deposits` in `tests/market.test.ts`.

**Location:** Same files as H2.

A sponsor who chose `lock=false` (withdrawable) must remember to call `withdraw_reward` before `stake_end`. The constraint `current_timestamp < stake_end` (line 68) closes the withdraw window at stake-end. If the market then fails to resolve, the deposit is stuck for the same reason as H2.

This is more pernicious than H2 because the sponsor explicitly *chose* the recoverable option. The UX promise "you can withdraw" silently breaks at `stake_end`, regardless of whether the market will resolve.

**Severity:** High. Direct loss-of-funds; sponsor cannot self-mitigate without trusting `market_authority`.

**Remediation:** Same shape as H2. Either:
- Allow `lock=false` sponsors to withdraw at any time pre-resolution (drop the `stake_end` cutoff), OR
- Add the expired-recovery branch from H2.

The first is simpler but allows sponsors to rug stakers right up until resolution. The second is the right one.

---

### [M1] Medium — `cancel_*_authority_change` rent goes to whichever signer calls it

**Location:** `cancel_update_authority_change.rs:14-22`, `cancel_fee_claim_authority_change.rs:14-22`.

```rust
#[account(
    mut,
    close = signer,
    seeds = [TIMELOCKED_CHANGE_SEED, UPDATE_AUTHORITY_SEED, platform_config.key().as_ref()],
    bump = timelocked_change.bump,
)]
pub timelocked_change: Account<'info, TimelockedAccountChange>,
```

The handler verifies `signer == update_authority || signer == proposed_value` (line 28-32), but `close = signer` means the proposed authority can claim the rent that the **update authority** paid in `propose_*` (line 24, `payer = update_authority`).

**Impact:** Trivial economic loss (sponsor pays ~0.001 SOL of rent). More importantly, this incentivizes the proposed authority to race-cancel just to capture rent if it's spammed.

**Remediation:** `close = update_authority` (read from `platform_config.update_authority`). Matches the parallel `finalize_*` instructions, which already use `close = update_authority`.

---

### [M2] Medium — `add_reward` allows depositing into a not-yet-open market with no time bound

**Location:** `add_reward.rs:55-117`.

```rust
if let Some(open_timestamp) = market.open_timestamp {
    ...require!(current_timestamp < stake_end, TimeWindowMismatch);
}
```

If `market.open_timestamp` is `None`, no time check applies and the only gate is `!market.resolved` — which is also true for never-opened markets. A sponsor can therefore deposit into a market that will never be opened (whose creator has gone away). Combined with H2/H3, the funds may be stuck.

**Likelihood:** Low — sponsors are presumably checking that the market is set up correctly. But the implicit "open_timestamp = None ⇒ deposits live forever in limbo" is a footgun.

**Remediation:** Require `market.open_timestamp.is_some()` in `add_reward`, OR allow withdrawal at any time when `open_timestamp.is_none()` (since no stakers can possibly have contributed yet).

---

### [M3] Medium — `init_stake_account` is permissionless and the resulting account has no close path until staked

**Location:** `init_stake_account.rs:7-50`, `close_stake_account.rs:24-34`, `close_stuck_stake_account.rs:23-30`.

Any signer can call `init_stake_account` for any `(owner, market, id)` triple, paying rent. The resulting fresh account has `pending_stake = false`, `staked_at_timestamp = None`, `stake_reclaimed = false`, `unstaked_at_timestamp = None`. There is no instruction that closes such an account:

- `close_stake_account` requires `stake_reclaimed || unstaked_at_timestamp.is_some()`.
- `close_stuck_stake_account` requires `pending_stake`.

So an attacker can pre-create stake accounts at low IDs (0, 1, 2, …) for any target owner. The target owner is forced to use larger IDs (UX cost), and the attacker has paid rent for nothing — but the PDAs are squatted permanently.

**Severity:** Medium-low — bounded by attacker's SOL (each squat costs rent). But the squatting *is* permanent. More importantly, this enables a subtle DoS: indexers and front-ends that assume the user owns stake account id=0 may misbehave.

**Remediation options:**
- Require the `owner` UncheckedAccount to also be a `Signer` (kills the gasless UX where a relayer pre-creates the account).
- Add a `close_unstaked_stake_account(owner: Signer)` instruction that lets the legitimate owner reclaim rent from an unused stake account — sends rent to `signer = owner`.
- Or accept the design and document that IDs may be squatted, with no economic impact.

---

### [M4] Medium — `reveal_stake` may be re-queued while a callback is already in flight

**Location:** `reveal_stake.rs:24-31`, `:69-126`, `:149-188`.

The account constraint allows `reveal_stake` to be called whenever `!locked || pending_reveal`. So a second `reveal_stake` is permitted while the first is still in flight. Each call queues a fresh Arcium computation. Sequence:

1. User A calls `reveal_stake` (pays computation fee). Q1 queued. `pending_reveal=true`.
2. User B (permissionless) calls `reveal_stake` on the same account before Q1 returns. Q2 queued. Same state.
3. Q1 callback returns first → sets `revealed_option`, `pending_reveal=false`, `locked=false`.
4. Q2 callback returns → `pending_reveal == false` → `require!` fails, callback errors.

**Impact:**
- User B wastes Arcium fees on a guaranteed-fail callback.
- The reveal_stake is permissionless by design, so an attacker can grief honest reveal-relayer services by racing in front of them — *the attacker pays the cost*, so this is mostly self-DoS.

**Severity:** Medium because real money (Arcium fees) is at stake. Mitigations:
- Tighten the constraint to `!locked` (allow only one in-flight reveal). Users still have a retry path because a failed callback returns `Err`, leaving `pending_reveal=true` per the comment at line 153 — *but the inline comment is wrong*: `reveal_stake_callback` returns `Err(e)` early **before** modifying state (line 161), so the `locked=true / pending_reveal=true` state persists, and the constraint `!locked || pending_reveal` is the only way back. So removing the `|| pending_reveal` would lock users out after a failed reveal.
- Cleaner: store the in-flight computation offset (same fix shape as C1) and only allow re-queuing if the previous offset has been observed as `Err` or expired.

---

### [L1] Low — `reveal_stake` does not check `reveal_ended_at.is_none()`

**Location:** `reveal_stake.rs:69-126`.

A late `reveal_stake` after `end_reveal_period` will queue and burn fees, but its result can never be counted because `increment_option_tally` requires `reveal_ended_at.is_none()`. Pure footgun for the caller, no protocol impact.

**Fix:** add `require!(market.reveal_ended_at.is_none(), RevealPeriodEnded);` to `reveal_stake`.

---

### [L2] Low — `set_winning_option` allows allocation before staking begins when `allow_closing_early=true`

**Location:** `set_winning_option.rs:27-93`.

```rust
if !ctx.accounts.market.allow_closing_early {
    require!(current_timestamp >= stake_end, ClosingEarlyNotAllowed);
}
```

Without `allow_closing_early`, the gate is `current_timestamp >= stake_end`. With it set, there is **no lower bound** — the authority can pick winners before `open_timestamp`, before any stake exists. Combined with `resolve_market` (which only requires `current_timestamp >= open_timestamp` and `allow_closing_early`), the market can be "resolved" pre-staking, killing it before it opens. Documented as a design choice but worth flagging.

**Fix:** add `require!(current_timestamp >= open_timestamp, TimeWindowMismatch);` to both `set_winning_option` and `resolve_market`. Doesn't restrict the early-close use case (the authority still picks after the market opens), but rules out the pre-open kill.

---

### [L3] Low — Once `option.selected = true`, the selection cannot be revoked

**Status: FIXED.** `set_winning_option` now accepts `reward_percentage = 0` (the lower-bound check was relaxed from `> 0 && <= 100` to just `<= 100`) and writes `option.selected = reward_percentage > 0`. Passing 0 unselects the option, releases its allocation slice back to `winning_option_allocation`, and causes `compute_user_reward` to short-circuit to `Ok(0)` for any prior voters of that option (they fall back to `reclaim_stake`).

**Location:** `set_winning_option.rs:80`, `state.rs:149-159`.

`reward_percentage` can be adjusted in subsequent calls, but `option.selected` is monotonic. A fat-finger by `market_authority` cannot be fully undone — the lowest possible `reward_percentage` is `1` (because of `require!(reward_percentage > 0)` at line 34).

**Fix:** allow `reward_percentage = 0` *and* `option.selected = false` via an explicit "unselect" instruction or by allowing `reward_percentage = 0` to clear the slot. Update the `winning_option_allocation` math accordingly.

---

### [L4] Low — Comment at `reveal_stake_callback` line 153-154 misstates control flow

**Location:** `reveal_stake.rs:153-161`.

> *"On failure, revert so the account stays locked with pending_reveal=true, allowing the user to retry reveal_stake"*

The handler returns `Err(e)` **before** any state mutation (line 161). So when a callback errors, no state changes; the account stays exactly as `reveal_stake` left it (`locked=true, pending_reveal=true`). The comment's intent is right but its mechanism description is misleading — there's no "revert"; the function never modified anything. Worth correcting since the comment is load-bearing for understanding the retry path.

---

### [L5] Low — `time_to_stake` is mutated by `resolve_market`; not documented in `state.rs`

**Location:** `resolve_market.rs:55-59`, `state.rs:62`.

When the authority resolves early under `allow_closing_early`, `time_to_stake` is overwritten with `current_timestamp - open_timestamp`. This is consistent across downstream consumers (`stake_end`, `reveal_start`, `select_deadline` all recompute from the new value) but the field's `// Seconds from open_timestamp` doc string makes it look immutable. Add: `// May be shortened by resolve_market when allow_closing_early=true.`

---

### [L6] Low — `init_stake_account` allows initialization for `market.resolved == true` and paused markets

**Location:** `init_stake_account.rs:7-29`.

No state check on the market. Creating a stake account on a resolved or paused market is harmless (the subsequent `stake` call will fail), but wastes rent. Cheap defensive constraint:

```rust
#[account(constraint = !market.resolved @ ErrorCode::WinnerAlreadySelected)]
pub market: Account<'info, OpportunityMarket>,
```

---

### [L7] Informational — `score::calculate_user_score_components`: `stake_since_opening.max(1)` peeks 1/PRECISION off the peak boost

**Location:** `score.rs:23-26`.

The test `peak_boost_when_staking_at_market_open` (line 100) documents that `.max(1)` "shaves one tick off the peak". For a 2× multiplier and 1-week cutoff, the loss is `10000 / 604800 ≈ 0.0017%` of the score — invisible in practice, but technically asymmetric (a staker at t=0 gets slightly less than a 2× boost). Either drop the `.max(1)` and special-case `stake_since_opening == 0`, or accept the imprecision (current behavior). No security impact.

---

## Variant analysis appendix

### Variant hunt 1 — "stale Arcium callback writes to reborn account" (root: C1)

Searched for the pattern *"in-flight async result identified only by a boolean flag, on an account that can be closed"*:

| Site | Closeable? | Boolean flag | Vulnerable to C1-style replay? |
|---|---|---|---|
| `stake_callback` | Yes — `close_stuck_stake_account` | `pending_stake` | **YES (C1)** |
| `reveal_stake_callback` | No — no instruction closes a non-reclaimed, non-unstaked account *during* a pending reveal | `pending_reveal` + `revealed_option.is_none()` | Hardened by `revealed_option.is_none()`; also deterministic plaintext. No replay corruption. Still worth binding to comp offset for defense in depth. |

### Variant hunt 2 — "fees / rewards stuck on expired markets" (root: H2/H3)

Searched for state that can be added to `market_token_ata` with no expiry-time escape hatch:

| Field | Increment site | Decrement sites | Stuck on expiry? |
|---|---|---|---|
| `collected_platform_fees` | `stake_callback` | `claim_fees` (no resolved check) | No — claimable indefinitely. ✓ |
| `collected_creator_fees` | `stake_callback` | `claim_creator_fees` (requires resolved); `close_stake_account` expired path | If unresolved: refunded to stakers via expired close path. ✓ |
| `reward_amount` (sponsor) | `add_reward` | `withdraw_reward` (pre-stake_end only) | **YES (H2 if locked, H3 if unlocked-and-late)** |
| `reward_amount` (staker fees) | `stake_callback` | `close_stake_account` (resolved or expired path) | No — both paths drain. ✓ |
| Original stake | `stake` token transfer | `reclaim_stake` / `do_unstake_early` / `close_stuck_stake_account` | No — `reclaim_stake` requires only `current_timestamp >= stake_end`. ✓ |

### Variant hunt 3 — "PDA-derived account passed without binding to a sibling account"

Searched for handlers that load two related accounts without enforcing their cross-linkage in code (relying purely on PDA seeds):

All cross-account bindings in the program are via PDA seeds (`stake_account` seeded by `market.key()`, `option` seeded by `market.key()`, `sponsor_account` seeded by `(sponsor, market)`). Because the seed includes the related account's pubkey, every binding is implicitly enforced — an attacker cannot pair an unrelated `stake_account` with the wrong `market` (the derived PDA wouldn't match). **No findings.**

### Variant hunt 4 — "rent recipient `close = X` mismatched with who paid the rent"

| Closing instruction | `close = ?` | Paid by | Match? |
|---|---|---|---|
| `close_stake_account` | `owner` | `payer` (could be anyone, gasless UX) | Owner gets rent; if relayer paid, owner now sits on relayer's rent. Donation-model. ✓ |
| `close_stuck_stake_account` | `signer` (= owner, enforced by `stake_account.owner == signer`) | `payer` (could be anyone) | Owner gets rent. ✓ |
| `withdraw_reward` | `sponsor` | `sponsor` (in `add_reward`) | ✓ |
| `finalize_new_update_authority` | `update_authority` | `update_authority` | ✓ |
| `finalize_new_fee_claim_authority` | `update_authority` | `update_authority` | ✓ |
| `cancel_update_authority_change` | `signer` (could be proposed_value) | `update_authority` | **mismatch — M1** |
| `cancel_fee_claim_authority_change` | `signer` (could be proposed_value) | `update_authority` | **mismatch — M1** |

### Variant hunt 5 — "Token-2022 extension surface" (root: H1)

Every site touching `market_token_ata`:

```
stake.rs:157           transfer_checked   signer → market         (gross stake)
reclaim_stake.rs:89    transfer_checked   market → owner          (net stake refund)
do_unstake_early.rs:104  transfer_checked  market → owner         (net stake refund)
close_stuck_stake_account.rs:87  transfer_checked  market → signer  (total refund)
close_stake_account.rs:131  transfer_checked  market → owner       (rewards / expired refund)
add_reward.rs:83       transfer_checked   sponsor → market        (sponsor deposit)
withdraw_reward.rs:84  transfer_checked   market → refund_account  (sponsor withdraw)
claim_fees.rs:63       transfer_checked   market → destination     (platform fees)
claim_creator_fees.rs:59  transfer_checked  market → destination   (creator fees)
```

All 9 paths inherit H1 — a single fix at `init_allowed_mint` covers all of them, which is the right place.

---

## Sharp-edges checklist (completed)

- [x] **Authentication bypasses** — None. All auth via `Signer` + `has_one` / explicit constraint.
- [x] **Authorization flaws (IDOR, privilege escalation)** — PDA seeds bind account ownership; signer keys verified.
- [x] **Injection vectors** — N/A (Rust / Anchor, no string templating into queries or shells).
- [x] **Cryptographic weaknesses** — Custom MPC delegated to Arcium; reviewed circuit (`encrypted-ixs/src/lib.rs`) is a thin pass-through.
- [x] **Resource exhaustion** — `add_market_option` allows unbounded options pre-stake-end (state bloat, but creator-paid). No unbounded loops in instructions.
- [x] **Race conditions / TOCTOU** — **C1** is exactly this class; **M4** is a milder variant.
- [x] **Information disclosure** — Events emit pubkeys, ciphertexts, nonces; no plaintext disclosure pre-reveal.
- [x] **Deserialization** — Anchor-managed; no manual `try_from_slice` on user data.
- [x] **Integer overflow** — All money math uses `checked_*` with `Overflow` mapping.
- [x] **Re-entrancy** — No same-program CPI; SPL token / Arcium are external.

---

## Severity definitions

- **Critical** — direct loss of user funds, vote integrity, or protocol invariants; triggerable from normal flows.
- **High** — loss of funds or strong invariants under reachable but uncommon conditions; trivial DoS of money paths.
- **Medium** — economic griefing, UX corruption, or invariants that hold only by convention.
- **Low / Informational** — code-quality, hardening, footguns.

---

## Reviewer's note on scope

This audit focused on on-chain logic invariants and trust boundaries. **Not assessed:** Arcium MPC node honesty (assumed trusted per docs), the `arcium-anchor` / `arcium-client` crates (assumed correct), the JS client / wallet flows, the deployed Arcium circuit binaries hosted at `pub-f4c38b2a6f20431a8856eb3b17373497.r2.dev` (verify hash equality with `circuit_hash!` macro before mainnet).

Before mainnet:
1. ~~Fix C1 unconditionally.~~ **Done.**
2. ~~Decide H1 stance (whitelist-only-classic vs. extension-validation), then implement.~~ **Done — extension deny-list in `init_allowed_mint`.**
3. ~~Pick a resolution for H2/H3 (expired sponsor recovery).~~ **Done — post-expiry branch in `withdraw_reward`.**
4. Triage the remaining Medium findings (M1–M4) and decide which to ship.
5. Run `arcium build` and re-verify the circuit hashes pinned in `init_comp_defs.rs`.
6. Regenerate JS bindings (`bun run generate` in `js/`) — `StakeAccount` layout changed (added `pending_stake_computation`, removed `pending_stake`).
