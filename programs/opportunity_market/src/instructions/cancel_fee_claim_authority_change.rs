use anchor_lang::prelude::*;

use crate::constants::{FEE_CLAIM_AUTHORITY_SEED, TIMELOCKED_CHANGE_SEED};
use crate::error::ErrorCode;
use crate::events::{emit_ts, AccountChangeCancelledEvent};
use crate::state::{PlatformConfig, TimelockedAccountChange};

#[derive(Accounts)]
pub struct CancelFeeClaimAuthorityChange<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    pub platform_config: Account<'info, PlatformConfig>,

    #[account(
        mut,
        close = signer,
        seeds = [TIMELOCKED_CHANGE_SEED, FEE_CLAIM_AUTHORITY_SEED, platform_config.key().as_ref()],
        bump = timelocked_change.bump,
    )]
    pub timelocked_change: Account<'info, TimelockedAccountChange>,
}

pub fn cancel_fee_claim_authority_change(ctx: Context<CancelFeeClaimAuthorityChange>) -> Result<()> {
    let signer = ctx.accounts.signer.key();
    let change = &ctx.accounts.timelocked_change;

    require!(
        signer == ctx.accounts.platform_config.update_authority
            || signer == change.proposed_value,
        ErrorCode::Unauthorized
    );

    emit_ts!(AccountChangeCancelledEvent {
        platform_config: ctx.accounts.platform_config.key(),
        change_type: "fee_claim_authority".to_string(),
        cancelled_by: signer,
        proposed_value: change.proposed_value,
    });

    Ok(())
}
