import { webhookCallback } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { BROADCAST_BATCH_SIZE, drainBroadcastQueue, sendTelegramText } from "./broadcast";
import { createBot } from "./bot";
import { createD1Repo } from "./d1-repo";
import { log, safeError } from "./log";
import { handleAppRequest } from "./mini-http";
import { callTelegram } from "./telegram";
import { verifyWebhookSecret } from "./webhook-auth";

let cachedBotInfo: UserFromGetMe | undefined;

async function runBroadcast(env: Env): Promise<void> {
  const repo = createD1Repo(env.DB);
  const stale = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  await repo.reclaimBroadcastLeases(stale);
  const result = await drainBroadcastQueue({
    take: () => repo.leaseBroadcastBatch(BROADCAST_BATCH_SIZE, new Date().toISOString()),
    finish: (id, status, error) => repo.finishBroadcastJob(id, status, error),
    send: (userId, text) => sendTelegramText(env.TELEGRAM_BOT_TOKEN, userId, text),
  });
  if (result.sent > 0 || result.failed > 0 || result.stopped) {
    log("info", "broadcast drain", {
      sent: result.sent,
      failed: result.failed,
      stopped: result.stopped,
    });
  }
}

export default {
  async fetch(request, env, _ctx): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") {
      return Response.json({ ok: true, service: "markus-brown" });
    }
    const appResponse = await handleAppRequest(request, {
      assets: env.ASSETS,
      runtime: () => ({
        token: env.TELEGRAM_BOT_TOKEN,
        adminId: env.ADMIN_ID,
        testMode: env.TEST_MODE,
        repo: createD1Repo(env.DB),
        now: () => new Date(),
        callTelegram: (method, body) => callTelegram(env.TELEGRAM_BOT_TOKEN, method, body),
      }),
    });
    if (appResponse) return appResponse;
    if (request.method !== "POST" || url.pathname !== "/webhook") {
      return new Response("not found", { status: 404 });
    }
    const provided = request.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
    const allowed = await verifyWebhookSecret(provided, env.WEBHOOK_SECRET);
    if (!allowed) {
      log("info", "webhook rejected");
      return new Response("unauthorized", { status: 401 });
    }
    try {
      const bot = createBot(
        {
          token: env.TELEGRAM_BOT_TOKEN,
          adminId: env.ADMIN_ID,
          testMode: env.TEST_MODE,
          appUrl: env.APP_URL,
          repo: createD1Repo(env.DB),
          now: () => new Date(),
        },
        cachedBotInfo,
      );
      const handle = webhookCallback(bot, "cloudflare-mod", {
        secretToken: env.WEBHOOK_SECRET,
        onTimeout: "return",
        timeoutMilliseconds: 9000,
      });
      const response = await handle(request);
      if (bot.isInited()) cachedBotInfo = bot.botInfo;
      return response;
    } catch (error) {
      log("error", "webhook failed", { error: safeError(error) });
      return new Response("error", { status: 500 });
    }
  },
  async scheduled(_controller, env, _ctx): Promise<void> {
    await runBroadcast(env);
  },
} satisfies ExportedHandler<Env>;
