// ─── Wallet Addresses ────────────────────────────────────────────────────────
export const WALLETS = {
  SOL: "9PmBXwMHa3pPqvQuYicZfeLsQYciXM5wG2TAN3TsFxGw",
  ETH: "0x765cD9517a03b98e466532B3511582D4a63a9070",
  BASE: "0x765cD9517a03b98e466532B3511582D4a63a9070",
  BNB: "0x765cD9517a03b98e466532B3511582D4a63a9070",
  HOOD: "0x765cD9517a03b98e466532B3511582D4a63a9070",
  ARC: "0x765cD9517a03b98e466532B3511582D4a63a9070",
  // Pump.fun has not been assigned a new receiving wallet yet.
  PUMP: "E9WvJYNR1JzcVSpMokEwoL4N1dvJ5nSKySb68TZmZVES",
};

// ─── Chains ───────────────────────────────────────────────────────────────────
export const CHAINS: Record<
  string,
  { name: string; symbol: string; wallet: string; explorer?: string }
> = {
  ETH: {
    name: "Ethereum",
    symbol: "ETH",
    wallet: WALLETS.ETH,
    explorer: "https://etherscan.io/tx/",
  },
  BNB: {
    name: "BNB Chain",
    symbol: "BNB",
    wallet: WALLETS.BNB,
    explorer: "https://bscscan.com/tx/",
  },
  BASE: {
    name: "Base",
    symbol: "ETH",
    wallet: WALLETS.BASE,
    explorer: "https://basescan.org/tx/",
  },
  HOOD: {
    name: "Robinhood",
    symbol: "ETH",
    wallet: WALLETS.HOOD,
  },
  ARC: {
    name: "Arc",
    symbol: "USDC",
    wallet: WALLETS.ARC,
  },
  SOL: {
    name: "Solana",
    symbol: "SOL",
    wallet: WALLETS.SOL,
    explorer: "https://solscan.io/tx/",
  },
  PUMP: {
    name: "Pump.fun",
    symbol: "SOL",
    wallet: WALLETS.PUMP,
    explorer: "https://solscan.io/tx/",
  },
};

export const TRENDING_CHANNELS: Record<string, string> = {
  SOL: "@MajorSolTrending",
  ETH: "@MajorEthTrending",
  BASE: "@MajorBaseTrending",
  BNB: "@MajorBscTrending",
  HOOD: "@MajorRobinHoodTrending",
  ARC: "@MajorARCTrending",
};

export type TrendingTier = "prime" | "ultra";
export const TRENDING_PACKAGE_PRICES: Record<
  string,
  Record<TrendingTier, Record<number, number>>
> = {
  SOL: {
    prime: { 4: 2.5, 8: 3.5, 12: 4.5, 24: 6.5 },
    ultra: { 4: 3.9, 8: 4.9, 12: 5.9, 24: 7.9 },
  },
  ETH: {
    prime: { 4: 0.1, 8: 0.14, 12: 0.18, 24: 0.26 },
    ultra: { 4: 0.15, 8: 0.2, 12: 0.25, 24: 0.32 },
  },
  BASE: {
    prime: { 4: 0.1, 8: 0.14, 12: 0.18, 24: 0.26 },
    ultra: { 4: 0.15, 8: 0.2, 12: 0.25, 24: 0.32 },
  },
  BNB: {
    prime: { 4: 0.28, 8: 0.38, 12: 0.48, 24: 0.68 },
    ultra: { 4: 0.42, 8: 0.52, 12: 0.62, 24: 0.82 },
  },
  HOOD: {
    prime: { 4: 0.1, 8: 0.14, 12: 0.18, 24: 0.26 },
    ultra: { 4: 0.15, 8: 0.2, 12: 0.25, 24: 0.32 },
  },
  ARC: {
    prime: { 4: 240, 8: 340, 12: 440, 24: 630 },
    ultra: { 4: 370, 8: 490, 12: 610, 24: 780 },
  },
};

// ─── Trending ─────────────────────────────────────────────────────────────────
// Base price per chain per hour (for Spot #1)
export const TRENDING_BASE_PRICES: Record<string, Record<number, number>> = {
  ETH: { 1: 0.1, 3: 0.25, 6: 0.45, 12: 0.8, 24: 1.4 },
  BNB: { 1: 0.3, 3: 0.8, 6: 1.4, 12: 2.5, 24: 4.5 },
  BASE: { 1: 0.08, 3: 0.2, 6: 0.36, 12: 0.65, 24: 1.1 },
  SOL: { 1: 1.5, 3: 4.0, 6: 7.0, 12: 12.0, 24: 20.0 },
  PUMP: { 1: 1.0, 3: 2.5, 6: 4.5, 12: 8.0, 24: 14.0 },
};

// Spot multipliers (Spot 1 = 1.0x, Spot 2 = 0.7x, Spot 3 = 0.5x)
export const TRENDING_SPOT_MULTIPLIERS: Record<number, number> = {
  1: 1.0,
  2: 0.7,
  3: 0.5,
};

export const TRENDING_SPOTS: Record<number, string> = {
  1: "🥇 Spot #1 — Top Position",
  2: "🥈 Spot #2",
  3: "🥉 Spot #3",
};

export const TRENDING_DURATIONS = [1, 3, 6, 12, 24];

export function getTrendingPrice(
  chain: string,
  hours: number,
  spot: number,
): string {
  const base = TRENDING_BASE_PRICES[chain]?.[hours] ?? 0;
  const mult = TRENDING_SPOT_MULTIPLIERS[spot] ?? 1;
  const price = +(base * mult).toFixed(4);
  return `${price} ${CHAINS[chain]?.symbol ?? chain}`;
}

// ─── Advertising Packages ─────────────────────────────────────────────────────
export const ADS_PACKAGES: Record<
  string,
  {
    name: string;
    description: string;
    features: string[];
    prices: Record<string, number>;
  }
> = {
  basic: {
    name: "📌 Basic Ad",
    description: "1 Channel Post + 24h Banner",
    features: ["1x channel post", "24h banner slot", "Token logo featured"],
    prices: { ETH: 0.05, BNB: 0.15, BASE: 0.04, SOL: 0.8, PUMP: 0.5 },
  },
  standard: {
    name: "📊 Standard Ad",
    description: "3 Posts + 48h Banner + Pinned Message",
    features: [
      "3x channel posts",
      "48h banner slot",
      "Pinned message (24h)",
      "Buy notification setup",
    ],
    prices: { ETH: 0.12, BNB: 0.35, BASE: 0.1, SOL: 1.8, PUMP: 1.2 },
  },
  premium: {
    name: "💎 Premium Ad",
    description: "7 Posts + 7d Banner + Button Ad + AMA",
    features: [
      "7x channel posts",
      "7d banner slot",
      "Button ad placement",
      "AMA session hosted",
      "Priority slot",
    ],
    prices: { ETH: 0.25, BNB: 0.75, BASE: 0.22, SOL: 4.0, PUMP: 2.5 },
  },
};

// ─── Community Trending ───────────────────────────────────────────────────────
export const COMMUNITY_PACKAGES: Record<
  string,
  {
    name: string;
    description: string;
    features: string[];
    prices: Record<string, number>;
  }
> = {
  votes50: {
    name: "50 Votes",
    description: "50 votes, valid for 24 hours",
    features: ["50 votes", "Valid for 24 hours"],
    prices: { SOL: 0.297, BNB: 0.04, ETH: 0.013 },
  },
  votes100: {
    name: "100 Votes",
    description: "100 votes, valid for 24 hours",
    features: ["100 votes", "Valid for 24 hours"],
    prices: { SOL: 0.495, BNB: 0.067, ETH: 0.021 },
  },
  votes250: {
    name: "250 Votes",
    description: "250 votes, valid for 24 hours",
    features: ["250 votes", "Valid for 24 hours"],
    prices: { SOL: 0.989, BNB: 0.133, ETH: 0.043 },
  },
  votes500: {
    name: "500 Votes",
    description: "500 votes, valid for 24 hours",
    features: ["500 votes", "Valid for 24 hours"],
    prices: { SOL: 1.484, BNB: 0.2, ETH: 0.064 },
  },
};

// ─── Marketing Bundles ────────────────────────────────────────────────────────
export const MARKETING_BUNDLES: Record<
  string,
  {
    name: string;
    tagline: string;
    features: string[];
    prices: Record<string, number>;
  }
> = {
  starter: {
    name: "🌱 Starter Bundle",
    tagline: "Perfect for new launches",
    features: [
      "Buy notification bot (48h)",
      "Volume campaign (24h)",
      "Bump bot (48h)",
      "1x channel announcement",
    ],
    prices: { ETH: 0.2, BNB: 0.6, BASE: 0.18, SOL: 3.0, PUMP: 2.0 },
  },
  growth: {
    name: "📈 Growth Bundle",
    tagline: "Scale your community",
    features: [
      "Everything in Starter",
      "Mass DMs — 5,000 targeted users",
      "AMA session (1h hosted)",
      "Banner ad (72h)",
      "Trending spot (3h)",
    ],
    prices: { ETH: 0.5, BNB: 1.5, BASE: 0.45, SOL: 7.5, PUMP: 5.0 },
  },
  premium: {
    name: "💎 Premium Bundle",
    tagline: "Full-scale marketing blitz",
    features: [
      "Everything in Growth",
      "Mass DMs — 20,000 targeted users",
      "Giveaway campaign",
      "Button ads (7 days)",
      "Trending spot #1 (6h)",
      "Dedicated account manager",
      "Priority 24/7 support",
    ],
    prices: { ETH: 1.0, BNB: 3.0, BASE: 0.9, SOL: 15.0, PUMP: 10.0 },
  },
};

export const VOLUME_BOOST_PACKAGES = {
  SOL: [
    ["25k", "$25K", "1.21 SOL"], ["50k", "$50K", "1.88 SOL"],
    ["100k", "$100K", "3.38 SOL"], ["200k", "$200K", "6.34 SOL"],
    ["400k", "🎁 $400K", "12.2 SOL"], ["800k", "🎁 $800K", "23.68 SOL"],
    ["1600k", "🎁 $1.6M", "46.32 SOL"], ["3200k", "🎁 $3.2M", "87.84 SOL"],
    ["6400k", "🎁 $6.4M", "171.01 SOL"], ["12800k", "🎁 $12.8M", "330.88 SOL"],
  ],
  BNB: [
    ["25k", "$25K", "0.21 BNB"], ["50k", "$50K", "0.32 BNB"],
    ["100k", "$100K", "0.55 BNB"], ["200k", "$200K", "1 BNB"],
    ["400k", "🎁 $400K", "1.87 BNB"], ["800k", "🎁 $800K", "3.61 BNB"],
    ["1600k", "🎁 $1.6M", "6.91 BNB"], ["3200k", "🎁 $3.2M", "13.18 BNB"],
    ["6400k", "🎁 $6.4M", "24.83 BNB"], ["12800k", "🎁 $12.8M", "48.25 BNB"],
  ],
  HOOD: [
    ["25k", "$25K", "0.077 ETH"], ["50k", "$50K", "0.122 ETH"],
    ["100k", "$100K", "0.214 ETH"], ["200k", "$200K", "0.384 ETH"],
    ["400k", "🎁 $400K", "0.72 ETH"], ["800k", "🎁 $800K", "1.387 ETH"],
    ["1600k", "🎁 $1.6M", "2.655 ETH"], ["3200k", "🎁 $3.2M", "5.064 ETH"],
    ["6400k", "🎁 $6.4M", "9.518 ETH"], ["12800k", "🎁 $12.8M", "18.5 ETH"],
  ],
  ARC: [
    ["25k", "$25K", "$138"], ["50k", "$50K", "$239"],
    ["100k", "$100K", "$451"], ["200k", "$200K", "$825"],
    ["400k", "🎁 $400K", "$1548"], ["800k", "🎁 $800K", "$3038"],
    ["1600k", "🎁 $1.6M", "$5885"], ["3200k", "🎁 $3.2M", "$11225"],
    ["6400k", "🎁 $6.4M", "$21625"], ["12800k", "🎁 $12.8M", "$42030"],
  ],
} as const;

// ─── Bot Meta ─────────────────────────────────────────────────────────────────
export const BOT_CONFIG = {
  channelUsername: "@MajorTrending",
  supportUsername: "@MajorBoostSupport",
  activationTime: "15–30 minutes",
};
