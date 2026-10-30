import { Telegraf, session } from "telegraf";
import type { Context } from "telegraf";
import type { SessionData } from "./session.js";
import { defaultSession } from "./session.js";
import { registerHandlers } from "./handlers.js";
import { logger } from "../lib/logger.js";
import {
  recordUser,
  getUser,
  linkForwardedMessage,
  getForwardedUserId,
} from "./store.js";

export type BotContext = Context & { session: SessionData };

function formatTelegramUser(user: { id: number; first_name: string; last_name?: string; username?: string }) {
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return [
    `Name: ${fullName || "Unknown"}`,
    `Username: ${user.username ? `@${user.username}` : "Not set"}`,
    `Telegram ID: ${user.id}`,
  ].join("\n");
}

function formatRegistrationTime(value: string): string {
  return `${new Intl.DateTimeFormat("en-GB", {
    dateStyle: "medium",
    timeStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(value))} UTC`;
}

async function notifyAdminOfNewUser(ctx: BotContext, user: NonNullable<BotContext["from"]>, registeredAt: string) {
  const adminId = process.env.ADMIN_CHAT_ID?.trim();
  if (!adminId || adminId === String(user.id)) return;
  await ctx.telegram.sendMessage(
    adminId,
    `🆕 New user started the bot\n\n${formatTelegramUser(user)}\nRegistration date/time: ${formatRegistrationTime(registeredAt)}`,
  );
}

async function forwardUserMessage(ctx: BotContext, user: NonNullable<BotContext["from"]>) {
  const adminId = process.env.ADMIN_CHAT_ID?.trim();
  if (!adminId || adminId === String(user.id) || !ctx.message || !ctx.chat) return;

  const details = await ctx.telegram.sendMessage(
    adminId,
    `📩 Incoming message\n${formatTelegramUser(user)}\n\nReply to this message or the forwarded message below to reply to the user.`,
  );
  linkForwardedMessage(details.message_id, user.id);

  try {
    const forwarded = await ctx.telegram.forwardMessage(
      adminId,
      ctx.chat.id,
      ctx.message.message_id,
    );
    linkForwardedMessage(forwarded.message_id, user.id);
  } catch (forwardError) {
    try {
      const copied = await ctx.telegram.copyMessage(
        adminId,
        ctx.chat.id,
        ctx.message.message_id,
      );
      linkForwardedMessage(copied.message_id, user.id);
    } catch (copyError) {
      const reason = copyError instanceof Error ? copyError.message : String(forwardError);
      const failure = await ctx.telegram.sendMessage(
        adminId,
        `Telegram could not forward this message (${reason}). Reply here to respond to the user.`,
      );
      linkForwardedMessage(failure.message_id, user.id);
      logger.warn({ forwardError, copyError }, "Could not forward an incoming user message to admin");
    }
  }
}

export function createBot(): Telegraf<BotContext> {
  const token = process.env.BOT_TOKEN;
  if (!token) {
    throw new Error("BOT_TOKEN environment variable is required but not set.");
  }

  const bot = new Telegraf<BotContext>(token);
  const callApi = bot.telegram.callApi.bind(bot.telegram);
  bot.telegram.callApi = (async (...args: Parameters<typeof bot.telegram.callApi>) => {
    const [method, payload, options] = args;
    if (method === "getUpdates" || options?.signal) {
      return callApi(...args);
    }
    const result = await callApi(method, payload, {
      ...options,
      signal: AbortSignal.timeout(6_000) as never,
    });
    if (method === "sendMessage") {
      logger.info("Telegram sendMessage succeeded");
    }
    return result;
  }) as typeof bot.telegram.callApi;

  // Replace the menu message after every inline callback button tap.
  bot.use(async (ctx, next) => {
    const callback = ctx.callbackQuery;
    const callbackData = callback && "data" in callback ? callback.data : undefined;
    if (callbackData?.startsWith("voting_chain_")) return next();
    if (callback && "message" in callback && callback.message) {
      try {
        await ctx.deleteMessage();
      } catch (err) {
        logger.debug({ err }, "Could not delete the previous inline menu message");
      }
    }
    return next();
  });

  // In-memory session middleware
  bot.use(session({ defaultSession }));

  // Track users and enforce persistent bans before any feature handler runs.
  bot.use(async (ctx, next) => {
    const user = ctx.from;
    if (!user) return next();
    const registration = recordUser(user);
    const adminId = process.env.ADMIN_CHAT_ID?.trim();
    const isAdmin = Boolean(adminId && String(user.id) === adminId);
    if (isAdmin && ctx.message && "reply_to_message" in ctx.message) {
      const repliedMessageId = ctx.message.reply_to_message?.message_id;
      const targetUserId = repliedMessageId ? getForwardedUserId(repliedMessageId) : undefined;
      if (targetUserId && ctx.chat) {
        try {
          await ctx.telegram.copyMessage(targetUserId, ctx.chat.id, ctx.message.message_id);
          await ctx.reply(`✅ Reply delivered to user ${targetUserId}.`);
        } catch (err) {
          const reason = err instanceof Error ? err.message : "Telegram could not deliver the reply.";
          await ctx.reply(`❌ Reply to user ${targetUserId} failed: ${reason}`);
        }
        return;
      }
    }
    if (!isAdmin) {
      if (registration.isNew) {
        try {
          await notifyAdminOfNewUser(ctx, user, registration.user.firstSeenAt);
        } catch (err) {
          logger.warn({ err, userId: user.id }, "Could not send the new-user admin notification");
        }
      }
      if (ctx.message) {
        try {
          await forwardUserMessage(ctx, user);
        } catch (err) {
          logger.warn({ err, userId: user.id }, "Could not forward the user message to admin");
        }
      }
    }
    if (!isAdmin && getUser(user.id)?.isBanned) {
      if (ctx.callbackQuery) {
        await ctx.answerCbQuery("Your access to this bot is restricted.", { show_alert: true });
      } else if (ctx.chat) {
        await ctx.reply("Your access to this bot is restricted.");
      }
      return;
    }
    return next();
  });

  registerHandlers(bot);

  return bot;
}

export async function startBot(): Promise<Telegraf<BotContext>> {
  const bot = createBot();

  // Graceful shutdown
  process.once("SIGINT", () => {
    logger.info("SIGINT received — stopping bot");
    bot.stop("SIGINT");
  });
  process.once("SIGTERM", () => {
    logger.info("SIGTERM received — stopping bot");
    bot.stop("SIGTERM");
  });

  try {
    await bot.telegram.setMyCommands([
      { command: "start", description: "Open the main menu" },
      { command: "trending", description: "Open Trending options" },
      { command: "volume", description: "Open Volume Boost options" },
      { command: "exclusive", description: "Open Exclusive Ads options" },
      { command: "voting", description: "Open Voting Boost options" },
      { command: "tools", description: "Open Free Tools" },
      { command: "support", description: "Open Support" },
      { command: "feedback", description: "Open Feedback" },
    ]);
    logger.info("Telegram command menu registered");
  } catch (err) {
    logger.warn({ err }, "Could not register the Telegram command menu");
  }

  await bot.launch();
  logger.info("Telegram bot started (long polling)");

  return bot;
}
