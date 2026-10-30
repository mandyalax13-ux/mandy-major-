import type { PromoType } from "./session.js";
import fs from "node:fs";
import path from "node:path";

export type OrderStatus =
  | "awaiting_payment"
  | "payment_submitted"
  | "verified"
  | "active"
  | "completed"
  | "cancelled";

export interface Order {
  id: string;
  userId: number;
  username?: string;
  firstName?: string;
  promoType: PromoType;
  chain: string;
  contractAddress: string;
  packageId: string;
  packageName: string;
  amount: string; // e.g. "0.05 ETH"
  walletAddress: string;
  txHash?: string;
  status: OrderStatus;
  createdAt: Date;
  updatedAt: Date;
  // Trending-specific
  trendingSpot?: number;
  trendingDuration?: number;
}

const ordersMap = new Map<string, Order>();

export interface BotUser {
  id: number;
  firstName: string;
  lastName?: string;
  username?: string;
  isBot: boolean;
  isBanned: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

type UserFile = { users: BotUser[]; forwardedMessages?: [number, number][] };
const dataDirectory = path.resolve(
  process.cwd(),
  path.basename(process.cwd()).toLowerCase() === "api-server"
    ? "data"
    : "artifacts/api-server/data",
);
const usersFile = path.join(dataDirectory, "bot-users.json");
const usersMap = new Map<number, BotUser>();
const forwardedMessages = new Map<number, number>();

try {
  const saved = JSON.parse(fs.readFileSync(usersFile, "utf8")) as UserFile;
  for (const user of saved.users ?? []) usersMap.set(user.id, user);
  for (const [messageId, userId] of saved.forwardedMessages ?? []) {
    forwardedMessages.set(messageId, userId);
  }
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
    console.error("Unable to load bot user records:", error);
  }
}

function saveUsers(): void {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const tempFile = `${usersFile}.tmp`;
  fs.writeFileSync(
    tempFile,
    JSON.stringify({ users: [...usersMap.values()], forwardedMessages: [...forwardedMessages] }, null, 2),
  );
  fs.renameSync(tempFile, usersFile);
}

export function recordUser(user: {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  is_bot?: boolean;
}): { user: BotUser; isNew: boolean } {
  const now = new Date().toISOString();
  const previous = usersMap.get(user.id);
  const updated: BotUser = {
    id: user.id,
    firstName: user.first_name,
    lastName: user.last_name ?? previous?.lastName,
    username: user.username ?? previous?.username,
    isBot: user.is_bot ?? false,
    isBanned: previous?.isBanned ?? false,
    firstSeenAt: previous?.firstSeenAt ?? now,
    lastSeenAt: now,
  };
  usersMap.set(user.id, updated);
  saveUsers();
  return { user: updated, isNew: !previous };
}

export function linkForwardedMessage(adminMessageId: number, userId: number): void {
  forwardedMessages.set(adminMessageId, userId);
  while (forwardedMessages.size > 10_000) {
    const oldest = forwardedMessages.keys().next().value;
    if (oldest === undefined) break;
    forwardedMessages.delete(oldest);
  }
  saveUsers();
}

export function getForwardedUserId(adminMessageId: number): number | undefined {
  return forwardedMessages.get(adminMessageId);
}

export function getUser(userId: number): BotUser | undefined {
  return usersMap.get(userId);
}

export function getUsers(): BotUser[] {
  return [...usersMap.values()].sort(
    (a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt),
  );
}

export function setUserBanned(userId: number, banned: boolean): BotUser {
  const now = new Date().toISOString();
  const user = usersMap.get(userId) ?? {
    id: userId,
    firstName: "Unknown user",
    isBot: false,
    isBanned: false,
    firstSeenAt: now,
    lastSeenAt: now,
  };
  const updated = { ...user, isBanned: banned };
  usersMap.set(userId, updated);
  saveUsers();
  return updated;
}

export function getUserStatistics() {
  const users = [...usersMap.values()];
  return {
    total: users.length,
    banned: users.filter((user) => user.isBanned).length,
    active: users.filter((user) => !user.isBanned).length,
  };
}

function generateId(): string {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).slice(2, 5).toUpperCase();
  return `MB-${timestamp}-${random}`;
}

export function createOrder(data: Omit<Order, "id" | "createdAt" | "updatedAt">): Order {
  const id = generateId();
  const now = new Date();
  const order: Order = { ...data, id, createdAt: now, updatedAt: now };
  ordersMap.set(id, order);
  return order;
}

export function getOrder(id: string): Order | undefined {
  return ordersMap.get(id);
}

export function updateOrder(id: string, updates: Partial<Omit<Order, "id" | "createdAt">>): Order | undefined {
  const order = ordersMap.get(id);
  if (!order) return undefined;
  const updated: Order = { ...order, ...updates, updatedAt: new Date() };
  ordersMap.set(id, updated);
  return updated;
}

export function getUserOrders(userId: number): Order[] {
  return [...ordersMap.values()]
    .filter((o) => o.userId === userId)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export function getAllOrders(): Order[] {
  return [...ordersMap.values()].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  );
}

export function getOrdersByStatus(status: OrderStatus): Order[] {
  return [...ordersMap.values()]
    .filter((o) => o.status === status)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}
