use anchor_lang::prelude::*;

use crate::constants::{TIMELOCKED_CHANGE_SEED, UPDATE_AUTHORITY_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, AccountChangeFinalizedEvent};
use crate::state::{PlatformConfig, TimelockedAccountChange};

#[derive(Accounts)]
pub struct FinalizeNewUpdateAuthority<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    /// The proposed new authority must co-sign to prevent fat-finger mistakes.
    pub proposed_authority: Signer<'info>,

    #[account(
        mut,
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    #[account(
        mut,
        close = update_authority,
        seeds = [TIMELOCKED_CHANGE_SEED, UPDATE_AUTHORITY_SEED, platform_config.key().as_ref()],
        bump = timelocked_change.bump,
        constraint = timelocked_change.proposed_value == proposed_authority.key() @ ErrorCode::Unauthorized,
    )]
    pub timelocked_change: Account<'info, TimelockedAccountChange>,
}

pub fn finalize_new_update_authority(ctx: Context<FinalizeNewUpdateAuthority>) -> Result<()> {
    let clock = Clock::get()?;
    let change = &ctx.accounts.timelocked_change;

    require!(
        clock.unix_timestamp >= change.execute_after,
        ErrorCode::TimelockNotElapsed
    );

    let old_value = ctx.accounts.platform_config.update_authority;
    ctx.accounts.platform_config.update_authority = change.proposed_value;

    emit_ts!(AccountChangeFinalizedEvent {
        platform_config: ctx.accounts.platform_config.key(),
        change_type: "update_authority".to_string(),
        old_value: old_value,
        new_value: change.proposed_value,
    });

    Ok(())
}
