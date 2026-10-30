import fs from "fs";
import path from "path";
import type { Telegraf } from "telegraf";
import { Markup } from "telegraf";
import type { BotContext } from "./index.js";
import { logger } from "../lib/logger.js";
import {
  CHAINS,
  ADS_PACKAGES,
  COMMUNITY_PACKAGES,
  MARKETING_BUNDLES,
  TRENDING_SPOTS,
  getTrendingPrice,
  TRENDING_CHANNELS,
  TRENDING_PACKAGE_PRICES,
  VOLUME_BOOST_PACKAGES,
  BOT_CONFIG,
  type TrendingTier,
} from "./config.js";
import {
  mainMenuKeyboard,
  chainKeyboard,
  trendingChainKeyboard,
  trendingPackageKeyboard,
  trendingSpotKeyboard,
  trendingDurationKeyboard,
  adsPackageKeyboard,
  exclusiveAdsKeyboard,
  exclusiveAdsDetailKeyboard,
  votingBoostKeyboard,
  marketingBundleKeyboard,
  paymentKeyboard,
  afterPaymentKeyboard,
  backToMenuKeyboard,
  volumeChainKeyboard,
  volumePackageKeyboard,
} from "./keyboards.js";
import {
  createOrder,
  updateOrder,
  getUserOrders,
  getAllOrders,
  getOrder,
  getUser,
  getUsers,
  getUserStatistics,
  setUserBanned,
  getForwardedUserId,
} from "./store.js";
import type { PromoType } from "./session.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────
function resetSession(ctx: BotContext) {
  ctx.session.step = "idle";
  ctx.session.promoType = undefined;
  ctx.session.chain = undefined;
  ctx.session.contractAddress = undefined;
  ctx.session.packageId = undefined;
  ctx.session.trendingSpot = undefined;
  ctx.session.trendingDuration = undefined;
  ctx.session.trendingTier = undefined;
  ctx.session.tokenName = undefined;
  ctx.session.tokenSymbol = undefined;
  ctx.session.orderId = undefined;
  ctx.session.adminFlow = undefined;
  ctx.session.adminTargetUserId = undefined;
}

async function acknowledgeCallback(ctx: BotContext): Promise<void> {
  try {
    await ctx.answerCbQuery();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/query is too old|query ID is invalid/i.test(message)) {
      logger.debug({ err }, "Ignoring expired callback acknowledgement");
      return;
    }
    throw err;
  }
}

function isValidContractAddress(address: string, chain: string): boolean {
  const trimmed = address.trim();
  if (chain === "SOL" || chain === "PUMP") {
    // Solana base58 address: 32–44 chars
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
  }
  // EVM: 0x + 40 hex chars
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed);
}

interface DetectedToken {
  name: string;
  symbol: string;
}

async function detectToken(chain: string, address: string): Promise<DetectedToken> {
  const dexChainIds: Record<string, string> = {
    SOL: "solana",
    PUMP: "solana",
    ETH: "ethereum",
    BASE: "base",
    BNB: "bsc",
    HOOD: "robinhood",
    ARC: "arc",
  };
  const dexChain = dexChainIds[chain];
  if (!dexChain) throw new Error("Token lookup is not available for this chain");

  const response = await fetch(
    `https://api.dexscreener.com/tokens/v1/${dexChain}/${encodeURIComponent(address)}`,
    { signal: AbortSignal.timeout(8_000) },
  );
  if (!response.ok) throw new Error(`Token lookup failed (${response.status})`);

  const pairs = (await response.json()) as Array<{
    chainId?: string;
    baseToken?: { address?: string; name?: string; symbol?: string };
    quoteToken?: { address?: string; name?: string; symbol?: string };
    liquidity?: { usd?: number };
  }>;
  const normalizedAddress = address.toLowerCase();
  const detected = pairs
    .filter((pair) => pair.chainId === dexChain)
    .map((pair) => {
      const token =
        pair.baseToken?.address?.toLowerCase() === normalizedAddress
          ? pair.baseToken
          : pair.quoteToken?.address?.toLowerCase() === normalizedAddress
            ? pair.quoteToken
            : undefined;
      return { token, liquidity: pair.liquidity?.usd ?? 0 };
    })
    .filter((pair) => pair.token?.name && pair.token.symbol)
    .sort((a, b) => b.liquidity - a.liquidity)[0]?.token;

  if (!detected?.name || !detected.symbol) {
    throw new Error("No token market data found for this address");
  }
  return { name: detected.name, symbol: detected.symbol };
}

function formatStatus(status: string): string {
  const map: Record<string, string> = {
    awaiting_payment: "⏳ Awaiting Payment",
    payment_submitted: "🔍 Verifying Payment",
    verified: "✅ Verified",
    active: "🚀 Active",
    completed: "✅ Completed",
    cancelled: "❌ Cancelled",
  };
  return map[status] ?? status;
}

// ─── Safe Edit Helper ─────────────────────────────────────────────────────────
// ctx.editMessageText fails on photo messages; fall back to a new reply.
async function safeEdit(
  ctx: BotContext,
  text: string,
  extra?: Parameters<(typeof ctx)["editMessageText"]>[1],
): Promise<void> {
  if (ctx.callbackQuery) {
    await ctx.reply(text, extra as Parameters<(typeof ctx)["reply"]>[1]);
    return;
  }
  try {
    await ctx.editMessageText(text, extra);
  } catch {
    await ctx.reply(text, extra as Parameters<(typeof ctx)["reply"]>[1]);
  }
}

async function sendPhotoWithKeyboard(
  ctx: BotContext,
  text: string,
  imagePath: string,
  keyboard: ReturnType<typeof mainMenuKeyboard>,
): Promise<void> {
  const chatId = ctx.chat?.id;
  if (!chatId) throw new Error("Chat ID is unavailable");

  await ctx.telegram.callApi(
    "sendPhoto",
    {
      chat_id: chatId,
      photo: { source: imagePath },
      caption: text,
      parse_mode: "Markdown",
      reply_markup: keyboard.reply_markup,
    },
    { signal: AbortSignal.timeout(2_000) as never },
  );
}

async function sendContractPrompt(ctx: BotContext, backAction: string) {
  const text = "⚙️ Please enter your CA:";
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback("Back", backAction)],
  ]);
  const imageCandidates = [
    path.join(process.cwd(), "assets", "token-ca.jpg"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "token-ca.jpg"),
  ];
  const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));

  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(ctx, text, imagePath, keyboard);
      return;
    } catch (err) {
      logger.warn({ err }, "Contract prompt photo upload failed; sending text prompt");
    }
  }
  await ctx.reply(text, keyboard);
}

async function sendTokenConfirmation(ctx: BotContext) {
  const chain = ctx.session.chain!;
  const chainLabel = chain === "BNB" ? "BSC" : chain;
  const tokenName = ctx.session.tokenName!;
  const tokenSymbol = ctx.session.tokenSymbol!;
  const buttonLabel = `${chainLabel} - ${tokenName} - (${tokenSymbol})`;
  const text = "✅ We have found the following project. Please confirm your token:";
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.callback(Array.from(buttonLabel).slice(0, 64).join(""), "confirm_token")],
    [Markup.button.callback("Back", "back_to_ca")],
  ]);
  const imageCandidates = [
    path.join(process.cwd(), "assets", "token-confirm.jpg"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "token-confirm.jpg"),
  ];
  const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));
  ctx.session.step = "token_confirm";

  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(ctx, text, imagePath, keyboard);
      return;
    } catch (err) {
      logger.warn({ err }, "Token confirmation photo upload failed; sending text prompt");
    }
  }
  await ctx.reply(text, keyboard);
}

// ─── Welcome & Main Menu ──────────────────────────────────────────────────────
export async function sendWelcome(ctx: BotContext) {
  resetSession(ctx);
  const text = `🚀 *Boost your token!* @MajorTrending\n\n🪙*New Trending Packages:*\n_Includes Button AD and Mass DM to reach all BuyBot users._\n\n📈 *Free Bumps, Market Maker or Holders*\n_Included with every Trending Ticket (SOL Chain only)._\n\n⚠️ *Disclaimer:* @MajorBotsHub`;

  const imageCandidates = [
    path.join(process.cwd(), "assets", "welcome.jpg"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "welcome.jpg"),
  ];
  const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));
  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(ctx, text, imagePath, mainMenuKeyboard());
      return;
    } catch (err) {
      logger.warn({ err }, "Welcome photo upload failed; sending menu without image");
    }
  }
  await ctx.reply(text, { parse_mode: "Markdown", ...mainMenuKeyboard() });
}

async function showTrendingPackageMenu(ctx: BotContext, chain: string) {
  const channel = TRENDING_CHANNELS[chain] ?? BOT_CONFIG.channelUsername;
  const primeBenefits = [
    "⭐ *Prime*",
    "• Button Ad (all Groups)",
    ...(chain === "SOL" ? ["• Free Bumps, Market Maker or Holders"] : []),
    `• Listing on ${channel}`,
    "• Guaranteed Top10",
  ].join("\n");
  const text = `${primeBenefits}\n\n💠 *Ultra*\n• Everything in Prime\n• Mass DM to 600K+ BuyBot users\n\n🔥 _Paid trendings rank first._\n_Longer duration = higher position._`;
  const imageCandidates = [
    path.join(process.cwd(), "assets", "package.jpg"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "package.jpg"),
  ];
  const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));
  ctx.session.step = "trending_package";

  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(
        ctx,
        text,
        imagePath,
        trendingPackageKeyboard(chain),
      );
      return;
    } catch (err) {
      logger.warn({ err }, "Trending package photo upload failed; sending menu without image");
    }
  }
  await ctx.reply(text, {
    parse_mode: "Markdown",
    ...trendingPackageKeyboard(chain),
  });
}

// ─── Promo Type Selection ──────────────────────────────────────────────────────
const EXCLUSIVE_ADS_MENU_TEXT =
  "🪙 *Exclusive Ads — High Impact Promotion for Your Project*\n\n" +
  "🔥 _Reach thousands of real users with our top tier ad options across the Major ecosystem._\n\n" +
  "⚡ _Choose one of the options below to learn more and boost your project visibility._";

const EXCLUSIVE_ADS_DETAILS = {
  ultimate: {
    image: "major-ultimate-boost.jpg",
    text:
      "🪙 *Major Ultimate Boost*\n\n" +
      "🌟 Maximum reach guaranteed! For ambitious tokens and presales, we offer an all-in-one package for maximum reach. By choosing one of our packages, you save a lot of money and, most importantly, time when it comes to organization. We have put together two packages for you.\n\n" +
      "🔥 *GOLD PACK*\n" +
      "✅ 24h Join Requirement\n" +
      "✅ 1 Mass DM\n" +
      "✅ 1 Day Button Ad\n" +
      "✅ Major AMA\n" +
      "✅ 24h Trending (Top 3)\n" +
      "✅ Call, X & AMA with Pin @LionCall\n" +
      "✅ Call @LionJungle\n\n" +
      "🔥 *PLATINUM PACK*\n" +
      "✅ 72h Join Requirement\n" +
      "✅ 2 Mass DM\n" +
      "✅ Major AMA\n" +
      "✅ 72h Trending (Top 3)\n" +
      "✅ Call, X & AMA @LionCall\n" +
      "✅ Call @LionJungle\n\n" +
      "⚠️ Contact us for more info!",
  },
  join2vote: {
    image: "join2vote.jpg",
    text:
      "🪙 *Join2Vote for Community Trending*\n\n" +
      "🔥 The ultimate tool for generating new members. All tokens participating in Major Community Trending (Voting) trend through user votes. Every user who wants to vote must first join your token group (see video). This is insane!\n\n" +
      "✅ Expected New Members: 4000 - 8000\n" +
      "✅ Duration: 24h or 72h\n\n" +
      "⚠️ Contact us for more info!",
  },
  massdm: {
    image: "mass-dm-promo.jpg",
    text:
      "🪙 *Mass DM via @MajorBuyBot*\n\n" +
      "🔥 One of our most popular and effective marketing tools. Do you have an upcoming launch? Does your token need more attention? Or do you want to promote a tool or channel? Our Mass DM tool is perfect for this and highly effective.\n\n" +
      "✅ Totally Members: +550.000 DM's\n" +
      "✅ Expected New Members: 500 - 1500\n" +
      "✅ Options: 1 or 2 DM's\n\n" +
      "⚠️ Contact us for more info!",
  },
  buttonads: {
    image: "button-ads.jpg",
    text:
      "🪙 *Button Ad on @MajorBuyBot & @MajorTrending*\n\n" +
      "🔥 Button Ad is one of our most frequently booked ads. With this ad, you reach thousands of users at the same time. Whether it's our Trending, all Hype Post notifications, or Buy notifications in all groups — the button is exclusively yours, generating high visibility.\n\n" +
      "✅ Totally Groups: +120.000\n" +
      "✅ Totally User: +17M\n" +
      "✅ Daily Impressions: +9M\n" +
      "✅ Expected New Members: 300 - 1500\n" +
      "✅ Options: 1, 3 or 7 Days\n\n" +
      "⚠️ Contact us for more info!",
  },
  ama: {
    image: "major-ama.jpg",
    text:
      "🪙 *Major AMA @MajorCommunityChat*\n\n" +
      "🔥 Through our livestreams, we are known for live reviews. In our daily livestreams, we offer 3-6 minutes of speaking time for developers. If you want more time to present your project and get the full spotlight, we offer our Exclusive Major AMA. Here, we give both our community and yours a fully transparent insight. For smart investors, an AMA is a highly effective decision-making tool. You can also reuse the video recording later to introduce your project to new investors.\n\n" +
      "✅ Members @MajorTrending: +105.000\n" +
      "✅ Members @MajorCommunityChat: +60.000\n" +
      "✅ Expected AMA Listener: 300 - 500\n" +
      "✅ Duration: 30 - 45 minutes\n" +
      "✅ Giveaways: $100-$200 (paid by us)",
  },
} as const;

type ExclusiveAdType = keyof typeof EXCLUSIVE_ADS_DETAILS;

function getExclusiveAdsImage(imageName: string): string | undefined {
  const candidates = [
    path.join(process.cwd(), "assets", imageName),
    path.join(process.cwd(), "artifacts", "api-server", "assets", imageName),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate));
}

async function sendExclusiveAdsMenu(ctx: BotContext): Promise<void> {
  ctx.session.promoType = "ads";
  ctx.session.step = "idle";
  const keyboard = exclusiveAdsKeyboard();
  const imagePath = getExclusiveAdsImage("exclusive-ads.jpg");
  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(ctx, EXCLUSIVE_ADS_MENU_TEXT, imagePath, keyboard);
      return;
    } catch (err) {
      logger.warn({ err }, "Exclusive Ads banner upload failed; sending menu without image");
    }
  }
  await ctx.reply(EXCLUSIVE_ADS_MENU_TEXT, { parse_mode: "Markdown", ...keyboard });
}

async function sendExclusiveAdsDetail(
  ctx: BotContext,
  key: ExclusiveAdType,
): Promise<void> {
  const detail = EXCLUSIVE_ADS_DETAILS[key];
  const keyboard = exclusiveAdsDetailKeyboard();
  const imagePath = getExclusiveAdsImage(detail.image);
  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(ctx, detail.text, imagePath, keyboard);
      return;
    } catch (err) {
      logger.warn({ err, key }, "Exclusive Ads detail banner upload failed; sending text");
    }
  }
  await ctx.reply(detail.text, { parse_mode: "Markdown", ...keyboard });
}

const VOTING_BOOST_TEXT =
  "🗳️ *Voting Boost*\n\n" +
  "⚡ Boost your token's votes instantly and climb higher in the @MajorCommunityTrending!\n\n" +
  "🌟 Each boost is valid for *24 hours* and adds instant votes to your project - no waiting, no limits. Anyone can support a token: developers, holders, or community members.\n\n" +
  "🗳️ *Top 3 Daily Winners*\n" +
  "_The top 3 tokens will be shared as our daily winners on our partner call channels._\n\n" +
  "🔥 *Boosts can be stacked:*\n" +
  "_Multiple boosts will add up to your total votes for even higher visibility._\n\n" +
  "➡️ Select the number of votes you want to purchase:";

async function sendVotingBoostMenu(
  ctx: BotContext,
  chain: "SOL" | "BNB" | "ETH",
) {
  ctx.session.promoType = "community";
  ctx.session.chain = chain;
  ctx.session.step = "community_package";
  await ctx.reply(VOTING_BOOST_TEXT, {
    parse_mode: "Markdown",
    ...votingBoostKeyboard(chain),
  });
}

async function startPromoFlow(ctx: BotContext, type: PromoType) {
  resetSession(ctx);
  ctx.session.promoType = type;

  if (type === "ads") {
    await sendExclusiveAdsMenu(ctx);
    return;
  }

  if (type === "community") {
    await sendVotingBoostMenu(ctx, "SOL");
    return;
  }

  if (type === "volume") {
    const text =
      "⭐ *Volume Boost*\n\n" +
      "Strategically increase the trading volume of your project on *SOLANA, BSC, ROBINHOOD or ARC* to boost activity and visibility.\n\n" +
      "🆕 *Full Control:*\n" +
      "✅ Pause or resume anytime\n" +
      "✅ Withdraw unused budget instantly\n\n" +
      "🔥 *Unique Features:*\n" +
      "✅ _Positive Buy-Sell Ratio_\n" +
      "✅ _Different wallets = organic trade history_\n" +
      "✅ _Varied transaction amounts_\n" +
      "✅ _Meets DEX trending requirements_\n\n" +
      "➡️ *Choose your chain:*";
    const imageCandidates = [
      path.join(process.cwd(), "assets", "volume-chain.jpg"),
      path.join(process.cwd(), "artifacts", "api-server", "assets", "volume-chain.jpg"),
    ];
    const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));
    ctx.session.step = "volume_chain";
    if (imagePath) {
      try {
        await sendPhotoWithKeyboard(ctx, text, imagePath, volumeChainKeyboard());
        return;
      } catch (err) {
        logger.warn({ err }, "Volume chain photo upload failed; sending menu without image");
      }
    }
    await ctx.reply(text, { parse_mode: "Markdown", ...volumeChainKeyboard() });
    return;
  }

  const titles: Record<PromoType, string> = {
    trending: "🚀 *Trending Promotion*",
    ads: "📢 *Advertising*",
    community: "🏆 *Community Trending*",
    volume: "Volume Boost",
    marketing: "📦 *Marketing Bundles*",
  };

  const descriptions: Record<PromoType, string> = {
    trending: "Book a trending spot in our channel and get seen by thousands.",
    ads: "Promote your token with channel posts, banners, and button ads.",
    community: "Run a community voting campaign and rise up the leaderboard.",
    marketing: "Full-scale marketing blitzes with DMs, bumps, AMAs & more.",
    volume: "Increase project trading volume with full budget controls.",
  };

  const text = type === "trending"
    ? "🆕 *Button AD included*\n_Every Trending Ticket comes with a guaranteed Button AD placement._\n\n🆕 *Mass DM (optional)*\n_Reach over 600K+ BuyBot users with an additional Mass DM push to maximize exposure._\n\n🎀 *Free Bumps, Market Maker or Holders!*\n_Every Trending includes extra support to fuel your momentum (SOL Chain only)._\n\n➡️ *Choose your chain:*"
    : `${titles[type]}\n\n${descriptions[type]}\n\n*Step 1 of 4* — Select your blockchain:`;

  if (type === "trending") {
    const imageCandidates = [
      path.join(process.cwd(), "assets", "trending-chain.jpg"),
      path.join(process.cwd(), "artifacts", "api-server", "assets", "trending-chain.jpg"),
    ];
    const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));
    if (imagePath) {
      try {
        await sendPhotoWithKeyboard(ctx, text, imagePath, trendingChainKeyboard());
      } catch (err) {
        logger.warn({ err }, "Trending chain photo upload failed; sending menu without image");
        await ctx.reply(text, { parse_mode: "Markdown", ...trendingChainKeyboard() });
      }
    } else {
      await ctx.reply(text, { parse_mode: "Markdown", ...trendingChainKeyboard() });
    }
  } else {
    await safeEdit(ctx, text, {
      parse_mode: "Markdown",
      ...chainKeyboard(),
    });
  }

  const stepMap: Record<PromoType, string> = {
    trending: "trending_chain",
    ads: "ads_chain",
    community: "community_chain",
    marketing: "marketing_chain",
    volume: "volume_chain",
  };
  ctx.session.step = stepMap[type] as typeof ctx.session.step;
}

// ─── Chain Selected ───────────────────────────────────────────────────────────
async function handleChainSelected(ctx: BotContext, chain: string) {
  ctx.session.chain = chain;

  if (ctx.session.step === "trending_chain") {
    await showTrendingPackageMenu(ctx, chain);
    return;
  }

  const stepContractMap: Record<string, typeof ctx.session.step> = {
    trending_chain: "trending_contract",
    ads_chain: "ads_contract",
    community_chain: "community_contract",
    marketing_chain: "marketing_contract",
    volume_chain: "volume_contract",
  };
  ctx.session.step = stepContractMap[ctx.session.step] ?? "idle";
  await sendContractPrompt(ctx, "back_to_chain");
}

function hasPromoPricing(chain: string, type: PromoType): boolean {
  if (type === "trending") return Boolean(TRENDING_PACKAGE_PRICES[chain]);
  if (type === "volume") return Boolean(VOLUME_BOOST_PACKAGES[chain as keyof typeof VOLUME_BOOST_PACKAGES]);
  const packages =
    type === "ads"
      ? Object.values(ADS_PACKAGES)
      : type === "community"
        ? Object.values(COMMUNITY_PACKAGES)
        : Object.values(MARKETING_BUNDLES);
  return packages.every((item) => Number(item.prices[chain]) > 0);
}

async function handleTrendingPackageSelected(
  ctx: BotContext,
  tier: TrendingTier,
  duration: number,
) {
  const chain = ctx.session.chain;
  if (!chain) {
    await acknowledgeCallback(ctx);
    await ctx.reply("Please choose a chain first.", mainMenuKeyboard());
    resetSession(ctx);
    return;
  }
  if (!CHAINS[chain]?.wallet) {
    await ctx.answerCbQuery(
      `${CHAINS[chain].name} payment details are not configured yet.`,
      { show_alert: true },
    );
    await showTrendingPackageMenu(ctx, chain);
    return;
  }
  await acknowledgeCallback(ctx);

  ctx.session.trendingTier = tier;
  ctx.session.trendingDuration = duration;
  ctx.session.packageId = `trending_${tier}_${duration}h`;
  ctx.session.step = "trending_contract";

  await sendContractPrompt(ctx, "trending_back_to_packages");
}

// ─── Contract Address Input (text message) ────────────────────────────────────
async function handleContractInput(ctx: BotContext, text: string) {
  const address = text.trim();
  const chain = ctx.session.chain!;

  if (!isValidContractAddress(address, chain)) {
    await ctx.reply(
      `⚠️ That doesn't look like a valid *${CHAINS[chain]?.name}* contract address.\n\nPlease paste the correct address:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("« Cancel", "menu")],
        ]),
      },
    );
    return;
  }

  ctx.session.contractAddress = address;
  try {
    const token = await detectToken(chain, address);
    ctx.session.tokenName = token.name;
    ctx.session.tokenSymbol = token.symbol;
    await sendTokenConfirmation(ctx);
  } catch (err) {
    logger.warn({ chain, err }, "Could not detect token metadata");
    await ctx.reply(
      "⚠️ I couldn't identify this token from market data. Check the CA and send it again.",
      Markup.inlineKeyboard([[Markup.button.callback("Back", "back_to_ca")]]),
    );
  }
}

async function showVolumePackageMenu(ctx: BotContext) {
  const chain = ctx.session.chain!;
  const chainName = chain === "BNB" ? "BSC" : chain === "HOOD" ? "Robinhood Chain" : chain === "SOL" ? "Solana" : "Arc";
  const fee = chain === "SOL"
    ? "Calculations are based on Raydium’s 0.25% swap fee. Results may vary depending on your pool setup."
    : chain === "BNB"
      ? "Calculations are based on PancakeSwap’s 0.25% swap fee. Results may vary depending on your pool setup."
      : "Calculations are based on Uniswap’s 0.3% swap fee. Results may vary depending on your pool setup.";
  const currentPriceLine = chain === "SOL"
    ? "✅ _Always adjusted to current SOL prices_\n"
    : chain === "BNB"
      ? "✅ _Always adjusted to current BNB prices_\n"
      : chain === "HOOD"
        ? "✅ _Always adjusted to current ETH prices_\n"
        : "";
  const text =
    `⭐ *${chainName} Volume Boost*\n\n` +
    `Boost the trading volume of your ${chainName} project to increase visibility and on-chain activity.\n\n` +
    `🎁 *Bonus Included:*\n+ _FREE Trending Ticket_ @MajorTrending\n\n` +
    `🔥 *Important:*\n` +
    `✅ _ALL COSTS INCLUDED – NO HIDDEN FEES_\n` +
    currentPriceLine +
    `✅ _Best price guarantee across all volume providers_\n` +
    `✅ _Realistic transaction patterns with varied wallets & amounts_\n` +
    `✅ _Full transparency and visible results within minutes_\n` +
    `✅ _You can pause or resume your boost anytime, and withdraw unused budget with full control_\n\n` +
    `⚙️ ${fee}`;
  const imageCandidates = [
    path.join(process.cwd(), "assets", "volume-price.jpg"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "volume-price.jpg"),
  ];
  const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));
  ctx.session.step = "volume_package";
  const keyboard = volumePackageKeyboard(chain);
  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(ctx, text, imagePath, keyboard);
      return;
    } catch (err) {
      logger.warn({ err }, "Volume price photo upload failed; sending menu without image");
    }
  }
  await ctx.reply(text, { parse_mode: "Markdown", ...keyboard });
}

async function continueAfterTokenConfirmation(ctx: BotContext) {
  const chain = ctx.session.chain!;
  const type = ctx.session.promoType!;
  if (type === "trending") {
    const tier = ctx.session.trendingTier!;
    const duration = ctx.session.trendingDuration!;
    const price = TRENDING_PACKAGE_PRICES[chain][tier][duration];
    await showPayment(
      ctx,
      ctx.session.packageId!,
      `${tier.toUpperCase()} — ${duration}h`,
      `${price.toFixed(2)} ${CHAINS[chain].symbol}`,
    );
  } else if (type === "volume") {
    await showVolumePackageMenu(ctx);
  } else if (type === "ads") {
    ctx.session.step = "ads_package";
    await ctx.reply(
      `✅ *Contract set!*\n\n*Step 3 of 4* — Choose an advertising package:`,
      { parse_mode: "Markdown", ...adsPackageKeyboard(chain) },
    );
  } else if (type === "community") {
    const packageId = ctx.session.packageId;
    const pkg = packageId ? COMMUNITY_PACKAGES[packageId] : undefined;
    const price = pkg?.prices[chain];
    if (!packageId || !pkg || price === undefined) {
      await sendVotingBoostMenu(ctx, "SOL");
      return;
    }
    await showPayment(
      ctx,
      packageId,
      pkg.name,
      `${price.toFixed(3)} ${CHAINS[chain].symbol}`,
    );
  } else {
    ctx.session.step = "marketing_bundle";
    await ctx.reply(
      `✅ *Contract set!*\n\n*Step 3 of 4* — Choose a marketing bundle:`,
      { parse_mode: "Markdown", ...marketingBundleKeyboard(chain) },
    );
  }
}

// ─── Trending: Spot Selected ──────────────────────────────────────────────────
async function handleSpotSelected(ctx: BotContext, spot: number) {
  ctx.session.trendingSpot = spot;
  ctx.session.step = "trending_duration";
  const chain = ctx.session.chain!;
  const spotName = TRENDING_SPOTS[spot];

  const text = `✅ *${spotName}*\n\n*Step 4 of 4* — Select duration:`;

  await safeEdit(ctx, text, {
    parse_mode: "Markdown",
    ...trendingDurationKeyboard(chain, spot),
  });
}

// ─── Show Payment Info & Create Order ────────────────────────────────────────
async function showPayment(
  ctx: BotContext,
  packageId: string,
  packageName: string,
  amount: string,
) {
  const chain = ctx.session.chain;
  const contract = ctx.session.contractAddress;
  if (!chain || !CHAINS[chain] || !contract || !ctx.session.promoType) {
    resetSession(ctx);
    await ctx.reply(
      "Your previous order session expired after the bot restarted. Please send /start to begin again.",
      mainMenuKeyboard(),
    );
    return;
  }

  const wallet = CHAINS[chain].wallet;
  const chainName = CHAINS[chain].name;
  const symbol = CHAINS[chain].symbol;

  if (!wallet) {
    resetSession(ctx);
    await ctx.reply(
      `Payment details for ${chainName} are not configured yet. Please contact ${BOT_CONFIG.supportUsername}.`,
      backToMenuKeyboard(),
    );
    return;
  }

  // Create order record
  const order = createOrder({
    userId: ctx.from!.id,
    username: ctx.from!.username,
    firstName: ctx.from!.first_name,
    promoType: ctx.session.promoType!,
    chain,
    contractAddress: contract,
    packageId,
    packageName,
    amount,
    walletAddress: wallet,
    status: "awaiting_payment",
    trendingSpot: ctx.session.trendingSpot,
    trendingDuration: ctx.session.trendingDuration,
  });

  ctx.session.orderId = order.id;
  ctx.session.step = "payment_hash";

  const tokenSymbol = ctx.session.tokenSymbol ?? "your token";
  const trending = ctx.session.promoType === "trending";
  const tier = ctx.session.trendingTier;
  const duration = ctx.session.trendingDuration;
  const channel = TRENDING_CHANNELS[chain] ?? BOT_CONFIG.channelUsername;
  const configuredPackage =
    ADS_PACKAGES[packageId] ?? COMMUNITY_PACKAGES[packageId] ?? MARKETING_BUNDLES[packageId];
  const summaryLines = trending
    ? [
        ...(tier === "ultra" ? ["Mass DM (+600K users)"] : []),
        `${duration ?? 12} Hours Button AD`,
        "Shared on: TG & X",
        `${duration ?? 12} Hours listing on ${channel}`,
        "Start: Immediately after payment",
      ]
    : ctx.session.promoType === "volume"
      ? [
          "Volume boost for your selected target",
          "FREE Trending Ticket @MajorTrending",
          "All costs included; pause or resume anytime and withdraw unused budget",
          "Start: Immediately after payment",
        ]
      : [
        ...(configuredPackage && "features" in configuredPackage
          ? configuredPackage.features
          : configuredPackage && "description" in configuredPackage
            ? [configuredPackage.description]
            : ["Start: Immediately after payment"]),
        "Start: Immediately after payment",
      ];
  const displayPackage = trending
    ? `${tier === "ultra" ? "Ultra" : "Prime"} ${duration}-Hour`
    : packageName;
  const text =
    `⚙️ *One last Step: Payment Required*\n\n` +
    `Thanks for submitting your project! To activate your ${displayPackage} Package for $${tokenSymbol}, please complete the payment within the next *15 minutes*.\n\n` +
    `🔥 *Order Summary*\n\n` +
    `💠 *${displayPackage}*\n` +
    summaryLines.map((line) => `• _${line}_`).join("\n") +
    `\n\n➡️ Send *${amount}* to this wallet:\n\`${wallet}\`\n\n` +
    `📊 *After payment, please reply to this message with your transaction hash (TX hash) to activate your booking.*`;

  const imageCandidates = [
    path.join(process.cwd(), "assets", "payment-last-step.jpg"),
    path.join(process.cwd(), "artifacts", "api-server", "assets", "payment-last-step.jpg"),
  ];
  const imagePath = imageCandidates.find((candidate) => fs.existsSync(candidate));
  if (imagePath) {
    try {
      await sendPhotoWithKeyboard(ctx, text, imagePath, paymentKeyboard());
      return;
    } catch (err) {
      logger.warn({ err }, "Payment menu photo upload failed; sending text prompt");
    }
  }
  await ctx.reply(text, { parse_mode: "Markdown", ...paymentKeyboard() });
}

// ─── TX Hash Input (text message) ─────────────────────────────────────────────
async function handleTxHashInput(ctx: BotContext, hash: string) {
  const trimmed = hash.trim();
  const orderId = ctx.session.orderId;

  if (!orderId) {
    await ctx.reply("⚠️ No active order found. Please start a new order.", {
      ...mainMenuKeyboard(),
    });
    resetSession(ctx);
    return;
  }

  // Basic TX hash validation (hex or base58)
  const isEvm = /^0x[0-9a-fA-F]{64}$/.test(trimmed);
  const isSol = /^[1-9A-HJ-NP-Za-km-z]{87,88}$/.test(trimmed);
  if (!isEvm && !isSol) {
    await ctx.reply(
      `⚠️ That doesn't look like a valid transaction hash.\n\nPlease paste the full TX hash from your wallet:`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("❌ Cancel Order", "cancel_order")],
        ]),
      },
    );
    return;
  }

  const order = updateOrder(orderId, {
    txHash: trimmed,
    status: "payment_submitted",
  });

  if (!order) {
    await ctx.reply("⚠️ Order not found. Please start a new order.", {
      ...mainMenuKeyboard(),
    });
    resetSession(ctx);
    return;
  }

  resetSession(ctx);

  const explorerUrl = CHAINS[order.chain]?.explorer
    ? `${CHAINS[order.chain].explorer}${trimmed}`
    : null;

  const text =
    `✅ *TX Hash Received!*\n\n` +
    `📋 Order: \`${order.id}\`\n` +
    `🔍 TX: \`${trimmed.slice(0, 20)}...${trimmed.slice(-10)}\`\n\n` +
    `Your order is now *under review*.\n` +
    `We will verify your payment and activate your campaign within *${BOT_CONFIG.activationTime}*.\n\n` +
    (explorerUrl ? `🔗 [View on Explorer](${explorerUrl})\n\n` : "") +
    `📱 Support: ${BOT_CONFIG.supportUsername}`;

  await ctx.reply(text, {
    parse_mode: "Markdown",
    link_preview_options: { is_disabled: true },
    ...afterPaymentKeyboard(),
  });

  // Notify admin if ADMIN_CHAT_ID is set
  const adminId = process.env.ADMIN_CHAT_ID;
  if (adminId) {
    try {
      const adminText =
        `🔔 *New Payment Submitted*\n\n` +
        `Order: \`${order.id}\`\n` +
        `User: ${order.firstName ?? "Unknown"} (@${order.username ?? "N/A"})\n` +
        `Type: ${order.promoType}\n` +
        `Chain: ${order.chain}\n` +
        `Package: ${order.packageName}\n` +
        `Amount: ${order.amount}\n` +
        `Contract: \`${order.contractAddress}\`\n` +
        `TX: \`${trimmed}\`\n\n` +
        `Use /verify ${order.id} to activate, /cancel ${order.id} to reject.`;
      await ctx.telegram.sendMessage(adminId, adminText, {
        parse_mode: "Markdown",
      });
    } catch {
      // Silent fail if admin notification fails
    }
  }
}

// ─── My Orders ────────────────────────────────────────────────────────────────
async function handleMyOrders(ctx: BotContext) {
  const orders = getUserOrders(ctx.from!.id);

  if (orders.length === 0) {
    const text = `📋 *My Orders*\n\nYou have no orders yet.\n\nStart a promotion to get your token trending! 🚀`;
    await ctx.reply(text, {
      parse_mode: "Markdown",
      ...backToMenuKeyboard(),
    });
    return;
  }

  const recent = orders.slice(0, 5);
  let text = `📋 *My Orders* (${orders.length} total)\n\n`;

  for (const order of recent) {
    const date = order.createdAt.toLocaleDateString();
    text +=
      `▸ \`${order.id}\`\n` +
      `  ${formatStatus(order.status)} — ${order.packageName}\n` +
      `  ${order.chain} • ${order.amount} • ${date}\n\n`;
  }

  if (orders.length > 5) {
    text += `_…and ${orders.length - 5} more_\n`;
  }

  await ctx.reply(text, { parse_mode: "Markdown", ...backToMenuKeyboard() });
}

// ─── Help & Support ───────────────────────────────────────────────────────────
async function handleHelp(ctx: BotContext) {
  const text =
    `ℹ️ *Help & Support*\n\n` +
    `*How it works:*\n` +
    `1. Choose a promotion type\n` +
    `2. Select your blockchain\n` +
    `3. Enter your token's contract address\n` +
    `4. Pick a package or slot\n` +
    `5. Send the exact payment amount\n` +
    `6. Submit your TX hash\n` +
    `7. Campaign activates within *${BOT_CONFIG.activationTime}*\n\n` +
    `*Supported Wallets:*\n` +
    `• ETH/BNB/BASE: \`0xcd0d...7C22\`\n` +
    `• SOL/PUMP: \`E9WvJ...ZVES\`\n\n` +
    `*Support:* ${BOT_CONFIG.supportUsername}\n` +
    `*Channel:* ${BOT_CONFIG.channelUsername}\n\n` +
    `*Common questions:*\n` +
    `❓ *How long until my campaign starts?*\n` +
    `→ Within ${BOT_CONFIG.activationTime} after payment confirmation.\n\n` +
    `❓ *What if I sent the wrong amount?*\n` +
    `→ Contact support immediately with your order ID.`;

  await ctx.reply(text, { parse_mode: "Markdown", ...backToMenuKeyboard() });
}

// ─── Admin Commands ───────────────────────────────────────────────────────────
async function handleAdminVerify(ctx: BotContext, orderId: string) {
  const adminId = process.env.ADMIN_CHAT_ID;
  if (!adminId || String(ctx.from?.id) !== adminId) {
    await ctx.reply("⛔ Unauthorized");
    return;
  }

  const order = getOrder(orderId);
  if (!order) {
    await ctx.reply(`❌ Order \`${orderId}\` not found.`, {
      parse_mode: "Markdown",
    });
    return;
  }

  updateOrder(orderId, { status: "active" });

  await ctx.reply(`✅ Order \`${orderId}\` verified and set to *active*!`, {
    parse_mode: "Markdown",
  });

  // Notify user
  try {
    await ctx.telegram.sendMessage(
      order.userId,
      `🚀 *Campaign Activated!*\n\nYour order \`${order.id}\` is now *active*!\n\n` +
        `Package: ${order.packageName}\n` +
        `Check it out: ${BOT_CONFIG.channelUsername}`,
      { parse_mode: "Markdown" },
    );
  } catch {
    // user may have blocked the bot
  }
}

async function handleAdminCancel(ctx: BotContext, orderId: string) {
  const adminId = process.env.ADMIN_CHAT_ID;
  if (!adminId || String(ctx.from?.id) !== adminId) {
    await ctx.reply("⛔ Unauthorized");
    return;
  }

  const order = getOrder(orderId);
  if (!order) {
    await ctx.reply(`❌ Order \`${orderId}\` not found.`, {
      parse_mode: "Markdown",
    });
    return;
  }

  updateOrder(orderId, { status: "cancelled" });
  await ctx.reply(`❌ Order \`${orderId}\` cancelled.`, {
    parse_mode: "Markdown",
  });
}

async function handleAdminOrders(ctx: BotContext) {
  const adminId = process.env.ADMIN_CHAT_ID;
  if (!adminId || String(ctx.from?.id) !== adminId) {
    await ctx.reply("⛔ Unauthorized");
    return;
  }

  const orders = getAllOrders().slice(0, 20);
  if (orders.length === 0) {
    await ctx.reply("No orders yet.");
    return;
  }

  let text = `📊 *All Orders (${orders.length})*\n\n`;
  for (const o of orders) {
    text +=
      `\`${o.id}\` — ${formatStatus(o.status)}\n` +
      `${o.promoType} • ${o.chain} • ${o.amount}\n` +
      `@${o.username ?? "N/A"} • ${o.createdAt.toLocaleDateString()}\n\n`;
  }

  await ctx.reply(text, { parse_mode: "Markdown" });
}

function isConfiguredAdmin(userId: number | undefined): boolean {
  const configuredId = process.env.ADMIN_CHAT_ID?.trim();
  return Boolean(userId && configuredId && String(userId) === configuredId);
}

const adminHomeKeyboard = () => Markup.inlineKeyboard([
  [Markup.button.callback("👥 User List", "admin:users:0")],
  [Markup.button.callback("✉️ Message a User", "admin:users:0")],
  [Markup.button.callback("🚫 Ban User", "admin:users:0")],
  [Markup.button.callback("☑ Unban User", "admin:users:0")],
  [Markup.button.callback("📊 Bot Statistics", "admin:stats")],
  [Markup.button.callback("Ban by Telegram ID", "admin:ban_by_id")],
  [Markup.button.callback("Unban by Telegram ID", "admin:unban_by_id")],
]);

function adminUsersKeyboard(page: number) {
  const users = getUsers();
  const pageSize = 8;
  const pages = Math.max(1, Math.ceil(users.length / pageSize));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const rows = users.slice(safePage * pageSize, (safePage + 1) * pageSize).map((user) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown user";
    const label = `${user.isBanned ? "🚫 " : ""}${name}${user.username ? ` (@${user.username})` : ""}`;
    return [Markup.button.callback(`${Array.from(label).slice(0, 55).join("")} · ${user.id}`, `admin:user:${user.id}:${safePage}`)];
  });
  const nav = [];
  if (safePage > 0) nav.push(Markup.button.callback("‹ Previous", `admin:users:${safePage - 1}`));
  nav.push(Markup.button.callback(`${safePage + 1}/${pages}`, "admin:noop"));
  if (safePage + 1 < pages) nav.push(Markup.button.callback("Next ›", `admin:users:${safePage + 1}`));
  if (nav.length) rows.push(nav);
  rows.push([Markup.button.callback("Admin Menu", "admin:home")]);
  return Markup.inlineKeyboard(rows);
}

function adminUserKeyboard(userId: number, page: number, isBanned: boolean) {
  return Markup.inlineKeyboard([
    [Markup.button.callback("✉️ Message User", `admin:message:${userId}:${page}`)],
    [Markup.button.callback(isBanned ? "☑ Unban User" : "🚫 Ban User", `admin:${isBanned ? "unban" : "ban"}:${userId}:${page}`)],
    [Markup.button.callback("Back to User List", `admin:users:${page}`)],
    [Markup.button.callback("Admin Menu", "admin:home")],
  ]);
}

async function showAdminUsers(ctx: BotContext, page: number) {
  const users = getUsers();
  const pages = Math.max(1, Math.ceil(users.length / 8));
  const safePage = Math.min(Math.max(page, 0), pages - 1);
  const slice = users.slice(safePage * 8, (safePage + 1) * 8);
  const lines = slice.map((user) => {
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown user";
    return `${user.isBanned ? "🚫 Banned" : "Active"} · ${name}${user.username ? ` (@${user.username})` : ""} · ID ${user.id}`;
  });
  await ctx.reply(`👥 Users (${users.length}) · Page ${safePage + 1}/${pages}\n\n${lines.length ? lines.join("\n") : "No users have interacted with the bot yet."}`, adminUsersKeyboard(safePage));
}

async function handleAdminCallback(ctx: BotContext, data: string) {
  if (!isConfiguredAdmin(ctx.from?.id)) {
    await ctx.answerCbQuery("Unauthorized", { show_alert: true });
    return;
  }
  await acknowledgeCallback(ctx);
  const [scope, action, rawId, rawPage] = data.split(":");
  if (scope !== "admin") return;
  if (action === "noop") return;
  if (action === "home") {
    ctx.session.adminFlow = undefined;
    await ctx.reply("🛠 Admin Menu", adminHomeKeyboard());
  } else if (action === "users") {
    await showAdminUsers(ctx, Number(rawId) || 0);
  } else if (action === "user") {
    const userId = Number(rawId);
    const page = Number(rawPage) || 0;
    const user = getUser(userId);
    if (!Number.isSafeInteger(userId) || !user) {
      await ctx.reply("User record not found.", adminUsersKeyboard(page));
      return;
    }
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown user";
    await ctx.reply(`👤 ${name}\nUsername: ${user.username ? `@${user.username}` : "Not set"}\nTelegram ID: ${user.id}\nStatus: ${user.isBanned ? "Banned" : "Active"}\nLast interaction: ${user.lastSeenAt}`, adminUserKeyboard(user.id, page, user.isBanned));
  } else if (action === "message") {
    ctx.session.adminFlow = "message_user";
    ctx.session.adminTargetUserId = Number(rawId);
    await ctx.reply(`Send the message or media you want delivered to user ${rawId}. Use /cancel to stop.`);
  } else if (action === "ban" || action === "unban") {
    const userId = Number(rawId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      await ctx.reply("That Telegram ID is invalid.", adminUsersKeyboard(Number(rawPage) || 0));
      return;
    }
    const user = setUserBanned(userId, action === "ban");
    const name = [user.firstName, user.lastName].filter(Boolean).join(" ") || "Unknown user";
    await ctx.reply(`${action === "ban" ? "🚫 Banned" : "☑ Unbanned"}: ${name} · ID ${user.id}`, adminUserKeyboard(user.id, Number(rawPage) || 0, user.isBanned));
  } else if (action === "ban_by_id" || action === "unban_by_id") {
    ctx.session.adminFlow = action === "ban_by_id" ? "ban_user" : "unban_user";
    await ctx.reply(`Send the Telegram user ID to ${action === "ban_by_id" ? "ban" : "unban"}. Use /cancel to stop.`);
  } else if (action === "stats") {
    const users = getUserStatistics();
    const orders = getAllOrders();
    const orderCounts = new Map<string, number>();
    for (const order of orders) orderCounts.set(order.status, (orderCounts.get(order.status) ?? 0) + 1);
    const statusLines = [...orderCounts.entries()].map(([status, count]) => `${status}: ${count}`);
    await ctx.reply(`📊 Bot Statistics\n\nRegistered users: ${users.total}\nActive users: ${users.active}\nBanned users: ${users.banned}\n\nOrders in current process: ${orders.length}\n${statusLines.length ? statusLines.join("\n") : "No orders recorded."}`, Markup.inlineKeyboard([[Markup.button.callback("Admin Menu", "admin:home")]]));
  }
}

async function handleAdminInput(ctx: BotContext): Promise<boolean> {
  if (isConfiguredAdmin(ctx.from?.id) && ctx.message && "reply_to_message" in ctx.message) {
    const repliedMessageId = ctx.message.reply_to_message?.message_id;
    const targetUserId = repliedMessageId ? getForwardedUserId(repliedMessageId) : undefined;
    if (targetUserId && ctx.chat) {
      try {
        await ctx.telegram.copyMessage(targetUserId, ctx.chat.id, ctx.message.message_id);
        await ctx.reply(`✅ Reply delivered to user ${targetUserId}.`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : "Telegram could not deliver the reply.";
        await ctx.reply(`❌ Reply to user ${targetUserId} failed: ${reason}`);
      }
      return true;
    }
  }
  const flow = ctx.session.adminFlow;
  if (!flow) return false;
  if (!isConfiguredAdmin(ctx.from?.id)) {
    ctx.session.adminFlow = undefined;
    ctx.session.adminTargetUserId = undefined;
    await ctx.reply("Unauthorized.");
    return true;
  }
  const message = ctx.message;
  if (!message || !ctx.chat) return true;
  const text = "text" in message ? message.text : undefined;
  if (text && /^\/cancel(?:@\w+)?(?:\s|$)/.test(text)) {
    ctx.session.adminFlow = undefined;
    ctx.session.adminTargetUserId = undefined;
    await ctx.reply("Admin action cancelled.", adminHomeKeyboard());
    return true;
  }
  if (flow === "message_user") {
    const targetId = ctx.session.adminTargetUserId;
    ctx.session.adminFlow = undefined;
    ctx.session.adminTargetUserId = undefined;
    if (!targetId) {
      await ctx.reply("No selected user. Start again from /admin.", adminHomeKeyboard());
      return true;
    }
    try {
      await ctx.telegram.copyMessage(targetId, ctx.chat.id, message.message_id);
      await ctx.reply(`✅ Message delivered to user ${targetId}.`);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Telegram could not deliver the message.";
      await ctx.reply(`❌ Message to user ${targetId} failed: ${reason}`);
    }
    return true;
  }
  const userId = Number(text?.trim());
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    await ctx.reply("Please send a valid numeric Telegram user ID, or /cancel.");
    return true;
  }
  const banned = flow === "ban_user";
  const user = setUserBanned(userId, banned);
  ctx.session.adminFlow = undefined;
  await ctx.reply(`${banned ? "🚫 User banned" : "☑ User unbanned"}: ${userId}`, adminHomeKeyboard());
  return true;
}

// ─── Register All Handlers ────────────────────────────────────────────────────
export function registerHandlers(bot: Telegraf<BotContext>) {
  // ── Commands ──────────────────────────────────────────────────────────────
  bot.command("start", sendWelcome);
  bot.command("menu", async (ctx) => {
    await sendWelcome(ctx);
  });
  for (const [command, type] of [
    ["trending", "trending"],
    ["volume", "volume"],
    ["ads", "ads"],
    ["exclusive", "ads"],
    ["voting", "community"],
  ] as const) {
    bot.command(command, async (ctx) => {
      await startPromoFlow(ctx, type);
    });
  }
  bot.command("tools", async (ctx) => {
    await ctx.reply(
      "Open Free Tools:",
      Markup.inlineKeyboard([
        [Markup.button.url("🎁 MajorBuyBot", "https://t.me/MajorBuyBot")],
      ]),
    );
  });
  bot.command("support", async (ctx) => {
    await ctx.reply(
      "Open Support:",
      Markup.inlineKeyboard([
        [Markup.button.url("💬 MajorHelpBot", "https://t.me/MajorHelpBot")],
      ]),
    );
  });
  bot.command("feedback", async (ctx) => {
    await ctx.reply(
      "Send Feedback:",
      Markup.inlineKeyboard([
        [
          Markup.button.url(
            "✏️ MajorFeedbackBot",
            "https://t.me/MajorFeedbackBot?start=start",
          ),
        ],
      ]),
    );
  });
  bot.command("orders", async (ctx) => {
    resetSession(ctx);
    await handleMyOrders(ctx as BotContext);
  });
  bot.command("help", async (ctx) => {
    await handleHelp(ctx as BotContext);
  });
  bot.command("admin", async (ctx) => {
    if (!isConfiguredAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ Unauthorized");
      return;
    }
    ctx.session.adminFlow = undefined;
    await ctx.reply("🛠 Admin Menu", adminHomeKeyboard());
  });
  bot.command("ban", async (ctx) => {
    if (!isConfiguredAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ Unauthorized");
      return;
    }
    const userId = Number(ctx.message.text.split(/\s+/)[1]);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      await ctx.reply("Usage: /ban TELEGRAM_USER_ID");
      return;
    }
    setUserBanned(userId, true);
    await ctx.reply(`User ${userId} is banned.`);
  });
  bot.command("unban", async (ctx) => {
    if (!isConfiguredAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ Unauthorized");
      return;
    }
    const userId = Number(ctx.message.text.split(/\s+/)[1]);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      await ctx.reply("Usage: /unban TELEGRAM_USER_ID");
      return;
    }
    setUserBanned(userId, false);
    await ctx.reply(`User ${userId} is unbanned.`);
  });
  bot.command("cancel", async (ctx) => {
    if (ctx.session.adminFlow) {
      await handleAdminInput(ctx as BotContext);
      return;
    }
    const parts = ctx.message?.text?.split(" ");
    const orderId = parts?.[1];
    if (orderId) {
      await handleAdminCancel(ctx as BotContext, orderId);
    } else {
      resetSession(ctx);
      await ctx.reply("❌ Flow cancelled.", mainMenuKeyboard());
    }
  });
  bot.command("verify", async (ctx) => {
    if (!isConfiguredAdmin(ctx.from?.id)) {
      await ctx.reply("⛔ Unauthorized");
      return;
    }
    const parts = ctx.message?.text?.split(" ");
    const orderId = parts?.[1];
    if (!orderId) {
      await ctx.reply("Usage: /verify ORDER_ID");
      return;
    }
    await handleAdminVerify(ctx as BotContext, orderId);
  });
  bot.command("allorders", async (ctx) => {
    await handleAdminOrders(ctx as BotContext);
  });

  bot.action(/^admin:/, async (ctx) => {
    const data = "data" in ctx.callbackQuery ? ctx.callbackQuery.data : "";
    await handleAdminCallback(ctx as BotContext, data);
  });

  // Copy admin messages/media to the selected user, then let other messages continue.
  bot.on("message", async (ctx, next) => {
    if (await handleAdminInput(ctx as BotContext)) return;
    return next();
  });

  // ── Main Menu Actions ──────────────────────────────────────────────────────
  bot.action("menu", async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendWelcome(ctx);
  });

  bot.action("promo_trending", async (ctx) => {
    await acknowledgeCallback(ctx);
    await startPromoFlow(ctx, "trending");
  });
  bot.action("trending_chains", async (ctx) => {
    await acknowledgeCallback(ctx);
    await startPromoFlow(ctx, "trending");
  });
  bot.action("trending_back_to_packages", async (ctx) => {
    await acknowledgeCallback(ctx);
    if (ctx.session.chain) {
      await showTrendingPackageMenu(ctx, ctx.session.chain);
    }
  });
  bot.action("back_to_chain", async (ctx) => {
    await acknowledgeCallback(ctx);
    if (ctx.session.promoType) {
      await startPromoFlow(ctx, ctx.session.promoType);
    } else {
      await sendWelcome(ctx);
    }
  });
  bot.action("volume_back_to_confirm", async (ctx) => {
    await acknowledgeCallback(ctx);
    if (ctx.session.tokenName && ctx.session.tokenSymbol) {
      await sendTokenConfirmation(ctx);
    } else {
      await startPromoFlow(ctx, "volume");
    }
  });
  bot.action("confirm_token", async (ctx) => {
    await acknowledgeCallback(ctx);
    if (ctx.session.step !== "token_confirm" || !ctx.session.tokenName) {
      await ctx.reply("Please submit and confirm a token CA first.", mainMenuKeyboard());
      resetSession(ctx);
      return;
    }
    await continueAfterTokenConfirmation(ctx);
  });
  bot.action("back_to_ca", async (ctx) => {
    await acknowledgeCallback(ctx);
    const type = ctx.session.promoType;
    if (!type) {
      await sendWelcome(ctx);
      return;
    }
    ctx.session.tokenName = undefined;
    ctx.session.tokenSymbol = undefined;
    ctx.session.step = `${type}_contract` as typeof ctx.session.step;
    await sendContractPrompt(
      ctx,
      type === "trending" ? "trending_back_to_packages" : "back_to_chain",
    );
  });
  bot.action("promo_ads", async (ctx) => {
    await acknowledgeCallback(ctx);
    await startPromoFlow(ctx, "ads");
  });
  bot.action("exclusive_ultimate", async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendExclusiveAdsDetail(ctx, "ultimate");
  });
  bot.action("exclusive_join2vote", async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendExclusiveAdsDetail(ctx, "join2vote");
  });
  bot.action("exclusive_massdm", async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendExclusiveAdsDetail(ctx, "massdm");
  });
  bot.action("exclusive_buttonads", async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendExclusiveAdsDetail(ctx, "buttonads");
  });
  bot.action("exclusive_ama", async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendExclusiveAdsDetail(ctx, "ama");
  });
  bot.action("exclusive_ads_back", async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendExclusiveAdsMenu(ctx);
  });
  bot.action("promo_community", async (ctx) => {
    await acknowledgeCallback(ctx);
    await startPromoFlow(ctx, "community");
  });
  bot.action("promo_marketing", async (ctx) => {
    await acknowledgeCallback(ctx);
    await startPromoFlow(ctx, "marketing");
  });
  bot.action("promo_volume", async (ctx) => {
    await acknowledgeCallback(ctx);
    await startPromoFlow(ctx, "volume");
  });

  // ── Chain Selection ────────────────────────────────────────────────────────
  for (const chain of Object.keys(CHAINS)) {
    bot.action(`chain_${chain}`, async (ctx) => {
      const promoType = ctx.session.promoType;
      if (promoType === "community") {
        await acknowledgeCallback(ctx);
        const votingChain = (["SOL", "BNB", "ETH"] as string[]).includes(chain)
          ? (chain as "SOL" | "BNB" | "ETH")
          : "SOL";
        await sendVotingBoostMenu(ctx, votingChain);
        return;
      }
      if (
        promoType &&
        !hasPromoPricing(chain, promoType)
      ) {
        await ctx.answerCbQuery(
          `${CHAINS[chain].name} pricing for this service is not configured yet.`,
          { show_alert: true },
        );
        await startPromoFlow(ctx, promoType);
        return;
      }
      await acknowledgeCallback(ctx);
      await handleChainSelected(ctx, chain);
    });
  }

  bot.action(/^trend_tier_(prime|ultra)$/, async (ctx) => {
    await ctx.answerCbQuery("Choose a duration in the matching column below.");
    if (ctx.session.chain) {
      await showTrendingPackageMenu(ctx, ctx.session.chain);
    }
  });
  for (const tier of ["prime", "ultra"] as const) {
    for (const duration of [4, 8, 12, 24]) {
      bot.action(`trendpkg_${tier}_${duration}`, async (ctx) => {
        await handleTrendingPackageSelected(ctx, tier, duration);
      });
    }
  }

  // ── Trending Spots ─────────────────────────────────────────────────────────
  for (const spot of [1, 2, 3]) {
    bot.action(`spot_${spot}`, async (ctx) => {
      await acknowledgeCallback(ctx);
      await handleSpotSelected(ctx, spot);
    });
  }

  // ── Trending Durations ─────────────────────────────────────────────────────
  for (const hours of [1, 3, 6, 12, 24]) {
    bot.action(`dur_${hours}`, async (ctx) => {
      await acknowledgeCallback(ctx);
      const chain = ctx.session.chain!;
      const spot = ctx.session.trendingSpot!;
      ctx.session.trendingDuration = hours;
      ctx.session.packageId = `trending_spot${spot}_${hours}h`;
      const label = TRENDING_SPOTS[spot];
      const duration = hours === 1 ? "1 Hour" : `${hours} Hours`;
      const amount = getTrendingPrice(chain, hours, spot);
      const packageName = `${label} — ${duration}`;
      await showPayment(ctx, ctx.session.packageId, packageName, amount);
    });
  }

  // ── Ads Packages ───────────────────────────────────────────────────────────
  for (const [key, pkg] of Object.entries(ADS_PACKAGES)) {
    bot.action(`ads_${key}`, async (ctx) => {
      await acknowledgeCallback(ctx);
      ctx.session.packageId = key;
      const chain = ctx.session.chain!;
      const symbol = CHAINS[chain]?.symbol ?? chain;
      const price = pkg.prices[chain] ?? 0;
      const amount = `${price} ${symbol}`;

      await showPayment(ctx, key, pkg.name, amount);
    });
  }

  // ── Voting Boost chain selector and vote packages ─────────────────────────
  for (const chain of ["SOL", "BNB", "ETH"] as const) {
    bot.action(`voting_chain_${chain}`, async (ctx) => {
      await acknowledgeCallback(ctx);
      ctx.session.promoType = "community";
      ctx.session.chain = chain;
      ctx.session.step = "community_package";
      try {
        await ctx.editMessageReplyMarkup(votingBoostKeyboard(chain).reply_markup);
      } catch (err) {
        logger.warn({ err }, "Could not update Voting Boost chain selection");
        await sendVotingBoostMenu(ctx, chain);
      }
    });
  }

  for (const [key, pkg] of Object.entries(COMMUNITY_PACKAGES)) {
    bot.action(`voting_package_${key}`, async (ctx) => {
      await acknowledgeCallback(ctx);
      const chain = (["SOL", "BNB", "ETH"] as string[]).includes(ctx.session.chain ?? "")
        ? (ctx.session.chain as "SOL" | "BNB" | "ETH")
        : "SOL";
      const price = pkg.prices[chain];
      ctx.session.promoType = "community";
      ctx.session.chain = chain;
      ctx.session.packageId = key;

      if (ctx.session.contractAddress && ctx.session.tokenName) {
        await showPayment(ctx, key, pkg.name, `${price.toFixed(3)} ${chain}`);
        return;
      }

      ctx.session.step = "community_contract";
      await sendContractPrompt(ctx, "voting_back_to_menu");
    });
  }

  bot.action(/^comm_(vote24|vote72|vote7d)$/, async (ctx) => {
    await acknowledgeCallback(ctx);
    await sendVotingBoostMenu(ctx, "SOL");
  });

  bot.action("voting_back_to_menu", async (ctx) => {
    await acknowledgeCallback(ctx);
    ctx.session.packageId = undefined;
    ctx.session.contractAddress = undefined;
    ctx.session.tokenName = undefined;
    ctx.session.tokenSymbol = undefined;
    const chain = (["SOL", "BNB", "ETH"] as string[]).includes(ctx.session.chain ?? "")
      ? (ctx.session.chain as "SOL" | "BNB" | "ETH")
      : "SOL";
    await sendVotingBoostMenu(ctx, chain);
  });

  // ── Marketing Bundles ──────────────────────────────────────────────────────
  for (const [key, bundle] of Object.entries(MARKETING_BUNDLES)) {
    bot.action(`mkt_${key}`, async (ctx) => {
      await acknowledgeCallback(ctx);
      ctx.session.packageId = key;
      const chain = ctx.session.chain!;
      const symbol = CHAINS[chain]?.symbol ?? chain;
      const price = bundle.prices[chain] ?? 0;
      const amount = `${price} ${symbol}`;

      await showPayment(ctx, key, bundle.name, amount);
    });
  }

  for (const chain of Object.keys(VOLUME_BOOST_PACKAGES) as Array<keyof typeof VOLUME_BOOST_PACKAGES>) {
    for (const [tier, label, amount] of VOLUME_BOOST_PACKAGES[chain]) {
      bot.action(`volume_${chain}_${tier}`, async (ctx) => {
        await acknowledgeCallback(ctx);
        ctx.session.packageId = `volume_${chain}_${tier}`;
        await showPayment(
          ctx,
          ctx.session.packageId,
          `${label.replace("🎁 ", "")} Volume Boost`,
          amount,
        );
      });
    }
  }

  // ── Payment Actions ────────────────────────────────────────────────────────
  bot.action("submit_hash", async (ctx) => {
    await acknowledgeCallback(ctx);
    if (ctx.session.step !== "payment_hash") {
      await ctx.reply(
        "No active payment. Please start a new order.",
        mainMenuKeyboard(),
      );
      return;
    }
    await safeEdit(
      ctx,
      `📋 Please paste your *transaction hash* below:\n\n_(The TX hash from your wallet after sending payment)_`,
      {
        parse_mode: "Markdown",
        ...Markup.inlineKeyboard([
          [Markup.button.callback("❌ Cancel", "cancel_order")],
        ]),
      },
    );
  });

  bot.action("payment_back", async (ctx) => {
    await acknowledgeCallback(ctx);
    if (ctx.session.orderId) updateOrder(ctx.session.orderId, { status: "cancelled" });
    ctx.session.orderId = undefined;
    const type = ctx.session.promoType;
    const chain = ctx.session.chain;
    if (type === "volume" && ctx.session.tokenName && ctx.session.tokenSymbol) {
      await showVolumePackageMenu(ctx);
      return;
    }
    if (type === "trending" && ctx.session.tokenName && ctx.session.tokenSymbol) {
      ctx.session.step = "token_confirm";
      await sendTokenConfirmation(ctx);
      return;
    }
    if (chain && (type === "ads" || type === "community" || type === "marketing")) {
      if (type === "ads") {
        ctx.session.step = "ads_package";
        await ctx.reply(`✅ *Contract set!*\n\n*Step 3 of 4* — Choose an advertising package:`, { parse_mode: "Markdown", ...adsPackageKeyboard(chain) });
      } else if (type === "community") {
        const votingChain = (["SOL", "BNB", "ETH"] as string[]).includes(chain)
          ? (chain as "SOL" | "BNB" | "ETH")
          : "SOL";
        await sendVotingBoostMenu(ctx, votingChain);
      } else {
        ctx.session.step = "marketing_bundle";
        await ctx.reply(`✅ *Contract set!*\n\n*Step 3 of 4* — Choose a marketing bundle:`, { parse_mode: "Markdown", ...marketingBundleKeyboard(chain) });
      }
      return;
    }
    await sendWelcome(ctx);
  });
  bot.action("cancel_order", async (ctx) => {
    await acknowledgeCallback(ctx);
    const orderId = ctx.session.orderId;
    if (orderId) {
      updateOrder(orderId, { status: "cancelled" });
    }
    resetSession(ctx);
    await safeEdit(
      ctx,
      "❌ Order cancelled.\n\nFeel free to start a new promotion:",
      mainMenuKeyboard(),
    );
  });

  // ── Info Actions ───────────────────────────────────────────────────────────
  bot.action("my_orders", async (ctx) => {
    await acknowledgeCallback(ctx);
    await handleMyOrders(ctx);
  });

  bot.action("help", async (ctx) => {
    await acknowledgeCallback(ctx);
    await handleHelp(ctx);
  });

  // ── Text Message Router ────────────────────────────────────────────────────
  bot.on("text", async (ctx) => {
    const text = ctx.message.text;

    // Ignore commands
    if (text.startsWith("/")) return;

    const step = ctx.session.step;

    if (
      step === "trending_contract" ||
      step === "ads_contract" ||
      step === "community_contract" ||
      step === "marketing_contract" ||
      step === "volume_contract"
    ) {
      await handleContractInput(ctx, text);
    } else if (step === "payment_hash") {
      await handleTxHashInput(ctx, text);
    } else {
      // Default: show menu
      await ctx.reply(
        "👋 Use the menu below to get started:",
        mainMenuKeyboard(),
      );
    }
  });

  // ── Error Handler ─────────────────────────────────────────────────────────
  bot.catch((err, ctx) => {
    logger.error({ err, updateType: ctx.updateType }, "Bot error");
  });
}


