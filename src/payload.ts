const PAYLOAD = /^v1:([a-z0-9]+):(\d+):(\d+)$/;

export function buildInvoicePayload(productId: string, userId: number, nowMs: number): string {
  const payload = `v1:${productId}:${userId}:${nowMs}`;
  if (new TextEncoder().encode(payload).length > 128) {
    throw new Error("invoice payload is too long");
  }
  return payload;
}

export function parseInvoicePayload(
  payload: string,
): { productId: string; userId: number; atMs: number } | null {
  const match = PAYLOAD.exec(payload);
  if (!match) return null;
  const userId = Number(match[2]);
  const atMs = Number(match[3]);
  if (!Number.isSafeInteger(userId) || !Number.isSafeInteger(atMs)) return null;
  return { productId: match[1] ?? "", userId, atMs };
}
