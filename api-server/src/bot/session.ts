export type PromoType = "trending" | "ads" | "community" | "marketing" | "volume";

export type Step =
  | "idle"
  // Trending flow
  | "trending_chain"
  | "trending_package"
  | "trending_contract"
  | "token_confirm"
  | "trending_spot"
  | "trending_duration"
  // Ads flow
  | "ads_chain"
  | "ads_contract"
  | "ads_package"
  // Community flow
  | "community_chain"
  | "community_contract"
  | "community_package"
  // Marketing flow
  | "marketing_chain"
  | "marketing_contract"
  | "marketing_bundle"
  // Volume boost
  | "volume_chain"
  | "volume_contract"
  | "volume_package"
  // Payment
  | "payment_hash";

export type AdminFlow = "message_user" | "ban_user" | "unban_user";

export interface SessionData {
  step: Step;
  promoType?: PromoType;
  chain?: string;
  contractAddress?: string;
  packageId?: string;
  trendingSpot?: number;
  trendingDuration?: number;
  trendingTier?: "prime" | "ultra";
  tokenName?: string;
  tokenSymbol?: string;
  orderId?: string;
  adminFlow?: AdminFlow;
  adminTargetUserId?: number;
}

export const defaultSession = (): SessionData => ({ step: "idle" });
