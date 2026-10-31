const SAFE = /^[a-z0-9_]{1,64}$/;

export function parseStartPayload(
  raw: string | undefined,
  productIds: readonly string[],
): { source: string | null; productId: string | null } {
  if (!raw) return { source: null, productId: null };
  const payload = raw.trim().toLowerCase();
  if (!SAFE.test(payload)) return { source: null, productId: null };
  const ids = [...productIds].sort((a, b) => b.length - a.length);
  for (const id of ids) {
    if (payload === id) return { source: id, productId: id };
    const prefix = `${id}_`;
    if (payload.startsWith(prefix)) {
      const source = payload.slice(prefix.length);
      return { source: source || id, productId: id };
    }
  }
  return { source: payload, productId: null };
}
