import { timingSafeEqual as nodeTimingSafeEqual } from "node:crypto";

type SubtleWithEqual = SubtleCrypto & {
  timingSafeEqual?: (a: BufferSource, b: BufferSource) => boolean;
};

function hashesMatch(left: ArrayBuffer, right: ArrayBuffer): boolean {
  const subtle = crypto.subtle as SubtleWithEqual;
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(left, right);
  }
  return nodeTimingSafeEqual(Buffer.from(left), Buffer.from(right));
}

/** Fail closed. Hash both values first so the compare does not leak the secret length. */
export async function verifyWebhookSecret(provided: string, expected: string): Promise<boolean> {
  if (expected.length === 0) return false;
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(provided)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  return hashesMatch(left, right);
}
