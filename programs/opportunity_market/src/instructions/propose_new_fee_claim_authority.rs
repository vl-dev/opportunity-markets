use anchor_lang::prelude::*;

use crate::constants::{FEE_CLAIM_AUTHORITY_SEED, TIMELOCK_DELAY_SECONDS, TIMELOCKED_CHANGE_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, AccountChangeProposedEvent};
use crate::state::{PlatformConfig, TimelockedAccountChange};

#[derive(Accounts)]
pub struct ProposeNewFeeClaimAuthority<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    /// CHECK: Stored as proposed value; must co-sign at finalize time.
    pub proposed_fee_claim_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = update_authority,
        space = 8 + TimelockedAccountChange::INIT_SPACE,
        seeds = [TIMELOCKED_CHANGE_SEED, FEE_CLAIM_AUTHORITY_SEED, platform_config.key().as_ref()],
        bump,
    )]
    pub timelocked_change: Account<'info, TimelockedAccountChange>,

    pub system_program: Program<'info, System>,
}

pub fn propose_new_fee_claim_authority(ctx: Context<ProposeNewFeeClaimAuthority>) -> Result<()> {
    let clock = Clock::get()?;
    let execute_after = clock
        .unix_timestamp
        .checked_add(TIMELOCK_DELAY_SECONDS)
        .ok_or(ErrorCode::Overflow)?;

    let change = &mut ctx.accounts.timelocked_change;
    change.bump = ctx.bumps.timelocked_change;
    change.current_value = ctx.accounts.platform_config.fee_claim_authority;
    change.proposed_value = ctx.accounts.proposed_fee_claim_authority.key();
    change.execute_after = execute_after;

    emit_ts!(AccountChangeProposedEvent {
        platform_config: ctx.accounts.platform_config.key(),
        change_type: "fee_claim_authority".to_string(),
        current_value: change.current_value,
        proposed_value: change.proposed_value,
        execute_after: execute_after,
    });

    Ok(())
}
