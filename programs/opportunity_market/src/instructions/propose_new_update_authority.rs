use anchor_lang::prelude::*;

use crate::constants::{TIMELOCK_DELAY_SECONDS, TIMELOCKED_CHANGE_SEED, UPDATE_AUTHORITY_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, AccountChangeProposedEvent};
use crate::state::{PlatformConfig, TimelockedAccountChange};

#[derive(Accounts)]
pub struct ProposeNewUpdateAuthority<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Account<'info, PlatformConfig>,

    /// CHECK: Stored as proposed value; must co-sign at finalize time.
    pub proposed_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = update_authority,
        space = 8 + TimelockedAccountChange::INIT_SPACE,
        seeds = [TIMELOCKED_CHANGE_SEED, UPDATE_AUTHORITY_SEED, platform_config.key().as_ref()],
        bump,
    )]
    pub timelocked_change: Account<'info, TimelockedAccountChange>,

    pub system_program: Program<'info, System>,
}

pub fn propose_new_update_authority(ctx: Context<ProposeNewUpdateAuthority>) -> Result<()> {
    let clock = Clock::get()?;
    let execute_after = clock
        .unix_timestamp
        .checked_add(TIMELOCK_DELAY_SECONDS)
        .ok_or(ErrorCode::Overflow)?;

    let change = &mut ctx.accounts.timelocked_change;
    change.bump = ctx.bumps.timelocked_change;
    change.current_value = ctx.accounts.platform_config.update_authority;
    change.proposed_value = ctx.accounts.proposed_authority.key();
    change.execute_after = execute_after;

    emit_ts!(AccountChangeProposedEvent {
        platform_config: ctx.accounts.platform_config.key(),
        change_type: "update_authority".to_string(),
        current_value: change.current_value,
        proposed_value: change.proposed_value,
        execute_after: execute_after,
    });

    Ok(())
}
