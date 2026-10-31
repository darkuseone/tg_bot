import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

export interface WebAppIdentity {
  id: number;
  username: string | null;
  firstName: string | null;
  startParam: string | null;
}

const MAX_AGE_SEC = 24 * 60 * 60;

type SubtleWithEqual = SubtleCrypto & {
  timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
};

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  const subtle = crypto.subtle as SubtleWithEqual;
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(left, right);
  }
  return nodeTimingSafeEqual(Buffer.from(left), Buffer.from(right));
}

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

async function signInitData(botToken: string, dataCheck: string): Promise<Uint8Array> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign("HMAC", key, encoder.encode(botToken));
  const dataKey = await crypto.subtle.importKey("raw", secret, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", dataKey, encoder.encode(dataCheck));
  return new Uint8Array(signature);
}

/** Telegram WebApp initData. Fail closed. https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app */
export async function readInitData(
  initData: string,
  botToken: string,
  nowSec: number,
): Promise<WebAppIdentity | null> {
  if (!initData || !botToken) return null;
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const pairs = [...params.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const dataCheck = pairs.map(([key, value]) => `${key}=${value}`).join("\n");
  const expected = await signInitData(botToken, dataCheck);
  const actual = hexToBytes(hash);
  if (!actual || !bytesEqual(expected, actual)) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate)) return null;
  if (nowSec - authDate > MAX_AGE_SEC || authDate - nowSec > 60) return null;

  const rawUser = params.get("user");
  if (!rawUser) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawUser);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const user = parsed as Record<string, unknown>;
  if (typeof user.id !== "number" || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
  const startParam = params.get("start_param");
  return {
    id: user.id,
    username: typeof user.username === "string" ? user.username : null,
    firstName: typeof user.first_name === "string" ? user.first_name : null,
    startParam: startParam && startParam.length > 0 ? startParam : null,
  };
}
