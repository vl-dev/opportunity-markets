use anchor_lang::prelude::*;
use crate::error::ErrorCode;
use crate::events::{emit_ts, MarketOpenedEvent};
use crate::state::OpportunityMarket;

#[derive(Accounts)]
pub struct OpenMarket<'info> {
    pub market_authority: Signer<'info>,

    #[account(
        mut,
        has_one = market_authority @ ErrorCode::Unauthorized,
        constraint = market.open_timestamp.is_none() @ ErrorCode::MarketAlreadyOpen,
    )]
    pub market: Account<'info, OpportunityMarket>,
}

pub fn open_market(ctx: Context<OpenMarket>, open_timestamp: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    let clock = Clock::get()?;
    let current_timestamp = clock.unix_timestamp as u64;

    require!(
        open_timestamp > current_timestamp,
        ErrorCode::InvalidParameters
    );

    market.open_timestamp = Some(open_timestamp);

    emit_ts!(MarketOpenedEvent {
        market: market.key(),
        creator: market.creator,
        open_timestamp: open_timestamp,
    });

    Ok(())
}
