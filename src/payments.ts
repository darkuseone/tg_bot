import { getProduct } from "./catalog";
import { checkInvoice } from "./invoice";
import { parseInvoicePayload } from "./payload";
import type { ChargeRecord, Repo } from "./repo";

export interface SuccessInput {
  chargeId: string;
  fromId: number;
  currency: string;
  totalAmount: number;
  payload: string;
  adminId: string;
  testMode: string | undefined;
  now: string;
}

export type SuccessResult =
  | { type: "granted"; productId: string; amount: number }
  | { type: "duplicate"; previous: ChargeRecord["outcome"]; delivered: boolean; productId: string | null }
  | { type: "already_owned"; productId: string }
  | { type: "rejected"; error: string };

export async function applySuccessfulPayment(repo: Repo, input: SuccessInput): Promise<SuccessResult> {
  let existing = await repo.getCharge(input.chargeId);
  if (!existing) {
    const parsed = parseInvoicePayload(input.payload);
    await repo.beginCharge({
      chargeId: input.chargeId,
      userId: input.fromId,
      product: parsed?.productId ?? null,
      amount: input.totalAmount,
      payload: input.payload,
      now: input.now,
    });
    existing = await repo.getCharge(input.chargeId);
  }
  if (existing && existing.outcome !== "processing") {
    const delivered = existing.outcome === "granted" ? await repo.isDelivered(input.chargeId) : true;
    return { type: "duplicate", previous: existing.outcome, delivered, productId: existing.product };
  }
  if (!existing) throw new Error("charge was not recorded");

  const parsed = parseInvoicePayload(input.payload);
  const product = parsed ? getProduct(parsed.productId) : undefined;
  const decision = checkInvoice({
    payload: input.payload,
    currency: input.currency,
    totalAmount: input.totalAmount,
    fromId: input.fromId,
    adminId: input.adminId,
    testMode: input.testMode,
    product,
    alreadyOwned: false,
  });
  if (!decision.ok) {
    await repo.finishCharge(input.chargeId, "rejected");
    return { type: "rejected", error: decision.error };
  }
  const inserted = await repo.insertPurchase({
    userId: input.fromId,
    product: decision.productId,
    chargeId: input.chargeId,
    amount: input.totalAmount,
    payload: input.payload,
    now: input.now,
  });
  if (inserted === "already_owned") {
    await repo.finishCharge(input.chargeId, "already_owned");
    return { type: "already_owned", productId: decision.productId };
  }
  if (inserted === "duplicate_charge") {
    await repo.finishCharge(input.chargeId, "granted");
    return {
      type: "duplicate",
      previous: "granted",
      delivered: await repo.isDelivered(input.chargeId),
      productId: decision.productId,
    };
  }
  await repo.finishCharge(input.chargeId, "granted");
  return { type: "granted", productId: decision.productId, amount: input.totalAmount };
}
