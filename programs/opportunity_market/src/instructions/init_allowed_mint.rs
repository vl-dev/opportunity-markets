use anchor_lang::prelude::*;
use anchor_spl::token_2022::spl_token_2022::extension::{
    BaseStateWithExtensions, ExtensionType, StateWithExtensions,
};
use anchor_spl::token_2022::spl_token_2022::state::Mint as SplMint;
use anchor_spl::token_interface::Mint;

use crate::constants::ALLOWED_MINT_SEED;
use crate::error::ErrorCode;
use crate::events::{emit_ts, AllowedMintInitializedEvent};
use crate::state::{AllowedMint, PlatformConfig};

// Reject mints with extensions that can break contract logic.
const FORBIDDEN_MINT_EXTENSIONS: &[ExtensionType] = &[
    ExtensionType::TransferFeeConfig,
    ExtensionType::PermanentDelegate,
    ExtensionType::TransferHook,
    ExtensionType::NonTransferable,
    ExtensionType::Pausable,
    ExtensionType::DefaultAccountState,
    ExtensionType::ConfidentialTransferMint,
    ExtensionType::ConfidentialTransferFeeConfig,
    ExtensionType::ConfidentialMintBurn,
    ExtensionType::InterestBearingConfig,
    ExtensionType::ScaledUiAmount,
    ExtensionType::MintCloseAuthority,
];

#[derive(Accounts)]
pub struct InitAllowedMint<'info> {
    #[account(mut)]
    pub update_authority: Signer<'info>,

    #[account(
        has_one = update_authority @ ErrorCode::Unauthorized,
    )]
    pub platform_config: Box<Account<'info, PlatformConfig>>,

    pub token_mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        init,
        payer = update_authority,
        space = 8 + AllowedMint::INIT_SPACE,
        seeds = [ALLOWED_MINT_SEED, platform_config.key().as_ref(), token_mint.key().as_ref()],
        bump,
    )]
    pub allowed_mint: Box<Account<'info, AllowedMint>>,

    pub system_program: Program<'info, System>,
}

pub fn init_allowed_mint(ctx: Context<InitAllowedMint>) -> Result<()> {
    let mint_ai = ctx.accounts.token_mint.to_account_info();
    let mint_data = mint_ai.try_borrow_data()?;
    let mint_with_ext = StateWithExtensions::<SplMint>::unpack(&mint_data)
        .map_err(|_| error!(ErrorCode::InvalidMint))?;
    for ext in mint_with_ext
        .get_extension_types()
        .map_err(|_| error!(ErrorCode::InvalidMint))?
    {
        require!(
            !FORBIDDEN_MINT_EXTENSIONS.contains(&ext),
            ErrorCode::InvalidMint
        );
    }
    drop(mint_data);

    let allowed_mint = &mut ctx.accounts.allowed_mint;
    allowed_mint.bump = ctx.bumps.allowed_mint;
    allowed_mint.platform = ctx.accounts.platform_config.key();
    allowed_mint.mint = ctx.accounts.token_mint.key();

    emit_ts!(AllowedMintInitializedEvent {
        allowed_mint: allowed_mint.key(),
        platform: allowed_mint.platform,
        mint: allowed_mint.mint,
    });

    Ok(())
}
