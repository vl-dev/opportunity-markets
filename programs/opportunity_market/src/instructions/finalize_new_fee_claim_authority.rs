use anchor_lang::prelude::*;

use crate::constants::{FEE_CLAIM_AUTHORITY_SEED, TIMELOCKED_CHANGE_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, AccountChangeFinalizedEvent};
use crate::state::{PlatformConfig, TimelockedAccountChange};

#[derive(Accounts)]
pub struct FinalizeNewFeeClaimAuthority<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    /// The proposed new fee-claim authority must co-sign to prevent fat-finger mistakes.
    pub proposed_fee_claim_authority: Signer<'info>,

    #[account(
        mut,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(
        mut,
        close = update_authority,
        seeds = [TIMELOCKED_CHANGE_SEED, FEE_CLAIM_AUTHORITY_SEED, platform_config.key().as_ref()],
        bump = timelocked_change.bump,
        constraint = timelocked_change.proposed_value == proposed_fee_claim_authority.key() @ ErrorCode::Unauthorized,
    )]
    pub timelocked_change: Account<'info, TimelockedAccountChange>,
}

pub fn finalize_new_fee_claim_authority(ctx: Context<FinalizeNewFeeClaimAuthority>) -> Result<()> {
    let clock = Clock::get()?;
    let change = &ctx.accounts.timelocked_change;

    require!(
        clock.unix_timestamp >= change.execute_after,
        ErrorCode::TimelockNotElapsed
    );

    let old_value = ctx.accounts.platform_config.fee_claim_authority;
    ctx.accounts.platform_config.fee_claim_authority = change.proposed_value;

    emit_ts!(AccountChangeFinalizedEvent {
        platform_config: ctx.accounts.platform_config.key(),
        change_type: "fee_claim_authority".to_string(),
        old_value: old_value,
        new_value: change.proposed_value,
    });

    Ok(())
}
