import type { UserFromGetMe } from "grammy/types";
import { InputFile } from "grammy";
import { createBot } from "../src/bot";
import { MemoryRepo } from "./memory-repo";

export interface ApiCall {
  method: string;
  body: Record<string, unknown>;
  raw: string;
}

const me: UserFromGetMe = {
  id: 111,
  is_bot: true,
  first_name: "Markus Brown",
  username: "markusbrown_bot",
  can_join_groups: false,
  can_read_all_group_messages: false,
  supports_inline_queries: false,
  can_connect_to_business: false,
  has_main_web_app: false,
  has_topics_enabled: false,
  allows_users_to_create_topics: false,
  can_manage_bots: false,
  supports_join_request_queries: false,
};

let updateId = 1;

export function user(id: number) {
  return { id, is_bot: false as const, first_name: "Тест", username: "tester" };
}

export function commandUpdate(text: string, userId = 7) {
  const command = text.split(/\s/)[0] ?? text;
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: userId, type: "private" as const },
      from: user(userId),
      text,
      entities: [{ type: "bot_command" as const, offset: 0, length: command.length }],
    },
  };
}

export function callbackUpdate(data: string, userId = 7) {
  return {
    update_id: updateId++,
    callback_query: {
      id: `cb-${updateId}`,
      from: user(userId),
      chat_instance: "chat",
      data,
      message: {
        message_id: 10,
        date: 1_700_000_000,
        chat: { id: userId, type: "private" as const },
        text: "screen",
      },
    },
  };
}

export function preCheckoutUpdate(payload: string, amount: number, userId = 7) {
  return {
    update_id: updateId++,
    pre_checkout_query: {
      id: `pc-${updateId}`,
      from: user(userId),
      currency: "XTR",
      total_amount: amount,
      invoice_payload: payload,
    },
  };
}

export function paymentUpdate(payload: string, amount: number, chargeId: string, userId = 7) {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: userId, type: "private" as const },
      from: user(userId),
      successful_payment: {
        currency: "XTR",
        total_amount: amount,
        invoice_payload: payload,
        telegram_payment_charge_id: chargeId,
        provider_payment_charge_id: "provider",
      },
    },
  };
}

export function documentUpdate(fileId: string, userId = 42) {
  return {
    update_id: updateId++,
    message: {
      message_id: updateId,
      date: 1_700_000_000,
      chat: { id: userId, type: "private" as const },
      from: { ...user(userId), id: userId },
      document: { file_id: fileId, file_unique_id: fileId, file_name: "course.pdf" },
    },
  };
}

export async function withBot(
  options: {
    adminId?: string;
    testMode?: string;
    repo?: MemoryRepo;
  },
  run: (tools: { repo: MemoryRepo; calls: ApiCall[]; handle: (update: unknown) => Promise<void> }) => Promise<void>,
): Promise<void> {
  const repo = options.repo ?? new MemoryRepo();
  const calls: ApiCall[] = [];
  const bot = createBot(
    {
      token: "test-token",
      adminId: options.adminId ?? "42",
      testMode: options.testMode ?? "0",
      appUrl: "https://markus-brown.kiritosinse.workers.dev",
      repo,
      now: () => new Date("2026-10-31T00:00:00.000Z"),
    },
    me,
  );
  bot.api.config.use((async (_prev: unknown, method: string, payload: Record<string, unknown>) => {
    const body = plainPayload(payload);
    calls.push({ method, body, raw: JSON.stringify(body) });
    if (method === "answerCallbackQuery" || method === "answerPreCheckoutQuery" || method === "refundStarPayment") {
      return { ok: true, result: true };
    }
    return {
      ok: true,
      result: {
        message_id: calls.length,
        date: 1_700_000_000,
        chat: { id: 1, type: "private" },
        photo: [{ file_id: `photo-${calls.length}`, file_unique_id: "u", width: 90, height: 90 }],
      },
    };
  }) as never);
  await run({
    repo,
    calls,
    handle: async (update) => {
      await bot.handleUpdate(update as never);
    },
  });
}

function plainPayload(payload: Record<string, unknown> | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload ?? {})) {
    body[key] = value instanceof InputFile ? { file: true } : value;
  }
  return body;
}
