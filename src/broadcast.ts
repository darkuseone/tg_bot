import type { BroadcastJob } from "./repo";

/** Free plan: 50 external subrequests per invocation. One sendMessage each, sent one by one. */
export const BROADCAST_BATCH_SIZE = 20;

export interface DrainResult {
  sent: number;
  failed: number;
  stopped: boolean;
}

export async function drainBroadcastQueue(input: {
  take: () => Promise<BroadcastJob[]>;
  finish: (id: number, status: "sent" | "pending" | "failed", error: string | null) => Promise<void>;
  send: (userId: number, text: string) => Promise<"sent" | "retry" | "failed">;
}): Promise<DrainResult> {
  const jobs = await input.take();
  let sent = 0;
  let failed = 0;
  for (const job of jobs) {
    const result = await input.send(job.userId, job.text);
    if (result === "retry") {
      await input.finish(job.id, "pending", "retry");
      return { sent, failed, stopped: true };
    }
    if (result === "failed") {
      await input.finish(job.id, "failed", "send failed");
      failed += 1;
      continue;
    }
    await input.finish(job.id, "sent", null);
    sent += 1;
  }
  return { sent, failed, stopped: false };
}

export async function sendTelegramText(
  token: string,
  chatId: number,
  text: string,
): Promise<"sent" | "retry" | "failed"> {
  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
  } catch {
    return "retry";
  }
  let data: { ok?: boolean; error_code?: number };
  try {
    data = (await response.json()) as { ok?: boolean; error_code?: number };
  } catch {
    return response.status === 429 ? "retry" : "failed";
  }
  if (data.ok) return "sent";
  if (data.error_code === 429 || response.status === 429) return "retry";
  return "failed";
}
