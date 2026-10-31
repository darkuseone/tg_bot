import { log } from "./log";

export async function callTelegram(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<unknown> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let data: { ok?: boolean; result?: unknown };
  try {
    data = (await response.json()) as { ok?: boolean; result?: unknown };
  } catch {
    log("error", "telegram response was not json", { method, status: response.status });
    throw new Error("telegram");
  }
  if (!data.ok) {
    log("error", "telegram method failed", { method, status: response.status });
    throw new Error("telegram");
  }
  return data.result;
}
