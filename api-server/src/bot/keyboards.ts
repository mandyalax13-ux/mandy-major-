import { Markup } from "telegraf";
import {
  CHAINS,
  TRENDING_SPOTS,
  TRENDING_DURATIONS,
  TRENDING_BASE_PRICES,
  TRENDING_SPOT_MULTIPLIERS,
  ADS_PACKAGES,
  COMMUNITY_PACKAGES,
  MARKETING_BUNDLES,
  TRENDING_PACKAGE_PRICES,
  type TrendingTier,
  VOLUME_BOOST_PACKAGES,
} from "./config.js";

// ─── Main Menu ────────────────────────────────────────────────────────────────
export const mainMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("⚡ Trending", "promo_trending"),
      Markup.button.callback("💰 Volume", "promo_volume"),
    ],
    [
      Markup.button.callback("📣 Exclusive Ads", "promo_ads"),
    ],
    [
      Markup.button.callback("🗳️ Voting Boost", "promo_community"),
      Markup.button.url("🎁 Free Tools", "https://t.me/MajorBuyBot"),
    ],
    [
      Markup.button.url("✏️ Feedback", "https://t.me/MajorFeedbackBot?start=start"),
      Markup.button.url("💬 Support", "https://t.me/MajorHelpBot"),
    ],
  ]);

// ─── Chain Selection ──────────────────────────────────────────────────────────
export const trendingChainKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("SOL", "chain_SOL"),
      Markup.button.callback("ETH", "chain_ETH"),
    ],
    [
      Markup.button.callback("BASE", "chain_BASE"),
      Markup.button.callback("BSC", "chain_BNB"),
    ],
    [
      Markup.button.callback("HOOD", "chain_HOOD"),
      Markup.button.callback("ARC", "chain_ARC"),
    ],
    [Markup.button.callback("Back", "menu")],
  ]);

export const chainKeyboard = () => trendingChainKeyboard();

export const volumeChainKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.callback("🟡 SOL", "chain_SOL"),
      Markup.button.callback("🟡 BSC", "chain_BNB"),
    ],
    [
      Markup.button.callback("🍃 Robinhood", "chain_HOOD"),
      Markup.button.callback("◡ Arc", "chain_ARC"),
    ],
    [Markup.button.callback("Back", "menu")],
  ]);

export const volumePackageKeyboard = (chain: string) => {
  const packages = VOLUME_BOOST_PACKAGES[chain as keyof typeof VOLUME_BOOST_PACKAGES];
  const rows = [];
  for (let index = 0; index < packages.length; index += 2) {
    const first = packages[index];
    const second = packages[index + 1];
    rows.push([
      Markup.button.callback(`${first[1]} | ${first[2]}`, `volume_${chain}_${first[0]}`),
      Markup.button.callback(`${second[1]} | ${second[2]}`, `volume_${chain}_${second[0]}`),
    ]);
  }
  rows.push([Markup.button.callback("Back", "volume_back_to_confirm")]);
  return Markup.inlineKeyboard(rows);
};

export const trendingPackageKeyboard = (chain: string) => {
  const prices = TRENDING_PACKAGE_PRICES[chain];
  const sym = CHAINS[chain]?.symbol ?? chain;
  const rows: ReturnType<typeof Markup.button.callback>[][] = [
    [
      Markup.button.callback("👇 PRIME", "trend_tier_prime"),
      Markup.button.callback("👇 ULTRA", "trend_tier_ultra"),
    ],
  ];

  for (const hours of [4, 8, 12, 24]) {
    rows.push([
      Markup.button.callback(
        `${hours}h | ${prices.prime[hours].toFixed(2)} ${sym}`,
        `trendpkg_prime_${hours}`,
      ),
      Markup.button.callback(
        `${hours}h | ${prices.ultra[hours].toFixed(2)} ${sym}`,
        `trendpkg_ultra_${hours}`,
      ),
    ]);
  }

  rows.push([Markup.button.callback("Back", "trending_chains")]);
  return Markup.inlineKeyboard(rows);
};

// ─── Trending: Spot Selection ─────────────────────────────────────────────────
export const trendingSpotKeyboard = (chain: string) => {
  const rows = Object.entries(TRENDING_SPOTS).map(([spot, label]) => {
    const spotNum = Number(spot);
    const basePrices = TRENDING_BASE_PRICES[chain] ?? {};
    const mult = TRENDING_SPOT_MULTIPLIERS[spotNum] ?? 1;
    const minPrice = +(Math.min(...Object.values(basePrices)) * mult).toFixed(3);
    const sym = CHAINS[chain]?.symbol ?? chain;
    return [
      Markup.button.callback(
        `${label}  (from ${minPrice} ${sym}/hr)`,
        `spot_${spot}`,
      ),
    ];
  });
  rows.push([Markup.button.callback("« Cancel", "menu")]);
  return Markup.inlineKeyboard(rows);
};

// ─── Trending: Duration Selection ─────────────────────────────────────────────
export const trendingDurationKeyboard = (chain: string, spot: number) => {
  const sym = CHAINS[chain]?.symbol ?? chain;
  const rows: ReturnType<typeof Markup.button.callback>[][] = [];

  const durations = TRENDING_DURATIONS;
  // 2 per row
  for (let i = 0; i < durations.length; i += 2) {
    const row = durations.slice(i, i + 2).map((h) => {
      const base = TRENDING_BASE_PRICES[chain]?.[h] ?? 0;
      const mult = TRENDING_SPOT_MULTIPLIERS[spot] ?? 1;
      const price = +(base * mult).toFixed(3);
      const label = h === 1 ? "1 Hour" : `${h} Hours`;
      return Markup.button.callback(`${label} — ${price} ${sym}`, `dur_${h}`);
    });
    rows.push(row);
  }
  rows.push([Markup.button.callback("« Cancel", "menu")]);
  return Markup.inlineKeyboard(rows);
};

// ─── Ads Package Selection ────────────────────────────────────────────────────
export const adsPackageKeyboard = (chain: string) => {
  const sym = CHAINS[chain]?.symbol ?? chain;
  const rows = Object.entries(ADS_PACKAGES).map(([key, pkg]) => {
    const price = pkg.prices[chain] ?? 0;
    return [
      Markup.button.callback(
        `${pkg.name}  —  ${price} ${sym}`,
        `ads_${key}`,
      ),
    ];
  });
  rows.push([Markup.button.callback("« Cancel", "menu")]);
  return Markup.inlineKeyboard(rows);
};

export const exclusiveAdsKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("⭐ Major Ultimate Boost", "exclusive_ultimate")],
    [Markup.button.callback("👆 Join2Vote", "exclusive_join2vote")],
    [
      Markup.button.callback("💬 Mass DM", "exclusive_massdm"),
      Markup.button.callback("🎯 Button Ads", "exclusive_buttonads"),
    ],
    [
      Markup.button.callback("🔊 Major AMA", "exclusive_ama"),
      Markup.button.callback("Back", "menu"),
    ],
  ]);

export const exclusiveAdsDetailKeyboard = () =>
  Markup.inlineKeyboard([
    [
      Markup.button.url("💬 Contact us Now", "https://t.me/MajorHelpBot"),
      Markup.button.callback("Back", "exclusive_ads_back"),
    ],
  ]);

// ─── Community Package Selection ──────────────────────────────────────────────
export const votingBoostKeyboard = (chain: "SOL" | "BNB" | "ETH") => {
  const rows = Object.entries(COMMUNITY_PACKAGES).map(([key, pkg]) => {
    const price = pkg.prices[chain];
    return [
      Markup.button.callback(
        `⚡ ${price.toFixed(3)} ${chain} | ${pkg.name}`,
        `voting_package_${key}`,
      ),
    ];
  });
  rows.push(
    (["SOL", "BNB", "ETH"] as const).map((option) =>
      Markup.button.callback(
        `${option === chain ? "✅ " : ""}${option}`,
        `voting_chain_${option}`,
      ),
    ),
  );
  rows.push([Markup.button.callback("Back", "menu")]);
  return Markup.inlineKeyboard(rows);
};

// ─── Marketing Bundle Selection ───────────────────────────────────────────────
export const marketingBundleKeyboard = (chain: string) => {
  const sym = CHAINS[chain]?.symbol ?? chain;
  const rows = Object.entries(MARKETING_BUNDLES).map(([key, bundle]) => {
    const price = bundle.prices[chain] ?? 0;
    return [
      Markup.button.callback(
        `${bundle.name}  —  ${price} ${sym}`,
        `mkt_${key}`,
      ),
    ];
  });
  rows.push([Markup.button.callback("« Cancel", "menu")]);
  return Markup.inlineKeyboard(rows);
};

// ─── Payment Keyboard ─────────────────────────────────────────────────────────
export const paymentKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("Send TX Hash", "submit_hash")],
    [Markup.button.callback("Cancel", "cancel_order")],
    [Markup.button.callback("Back", "payment_back")],
  ]);

// ─── Post-Payment ─────────────────────────────────────────────────────────────
export const afterPaymentKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("📋 View My Orders", "my_orders")],
    [Markup.button.callback("🏠 Back to Menu", "menu")],
  ]);

// ─── Cancel / Back ────────────────────────────────────────────────────────────
export const backToMenuKeyboard = () =>
  Markup.inlineKeyboard([
    [Markup.button.callback("🏠 Back to Menu", "menu")],
  ]);

