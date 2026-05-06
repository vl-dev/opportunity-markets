use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::constants::FEE_VAULT_SEED;
use crate::events::{emit_ts, FeeVaultInitializedEvent};
use crate::state::FeeVault;

#[derive(Accounts)]
pub struct InitFeeVault<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = payer,
        space = 8 + FeeVault::INIT_SPACE,
        seeds = [FEE_VAULT_SEED, token_mint.key().as_ref()],
        bump,
    )]
    pub fee_vault: Box<Account<'info, FeeVault>>,

    #[account(
        init,
        payer = payer,
        associated_token::mint = token_mint,
        associated_token::authority = fee_vault,
        associated_token::token_program = token_program,
    )]
    pub fee_vault_ata: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

pub fn init_fee_vault(ctx: Context<InitFeeVault>) -> Result<()> {
    let vault = &mut ctx.accounts.fee_vault;
    vault.bump = ctx.bumps.fee_vault;
    vault.mint = ctx.accounts.token_mint.key();
    vault.collected_fees = 0;

    emit_ts!(FeeVaultInitializedEvent {
        fee_vault: vault.key(),
        mint: vault.mint,
    });

    Ok(())
}
