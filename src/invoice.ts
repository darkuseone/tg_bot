import type { Product } from "./catalog";
import { parseInvoicePayload } from "./payload";
import { priceForUser } from "./pricing";

export const INVOICE_ERRORS = {
  payload: "Счёт устарел или повреждён. Открой бота и оформи оплату заново.",
  product: "Этого продукта уже нет. Открой бота и выбери другой.",
  user: "Этот счёт выписан другому человеку.",
  currency: "Оплата только звёздами Telegram.",
  price: "Сумма не совпадает с ценой. Открой бота и оформи счёт заново.",
  owned: "Этот продукт уже куплен. Открой «Мои покупки».",
} as const;

export type InvoiceDecision =
  | { ok: true; productId: string; expectedAmount: number }
  | { ok: false; error: string };

export function checkInvoice(input: {
  payload: string;
  currency: string;
  totalAmount: number;
  fromId: number;
  adminId: string;
  testMode: string | undefined;
  product: Product | undefined;
  alreadyOwned: boolean;
}): InvoiceDecision {
  const parsed = parseInvoicePayload(input.payload);
  if (!parsed) return { ok: false, error: INVOICE_ERRORS.payload };
  if (!input.product || input.product.id !== parsed.productId || input.product.hidden) {
    return { ok: false, error: INVOICE_ERRORS.product };
  }
  if (parsed.userId !== input.fromId) return { ok: false, error: INVOICE_ERRORS.user };
  if (input.currency !== "XTR") return { ok: false, error: INVOICE_ERRORS.currency };
  const expectedAmount = priceForUser({
    publicPrice: input.product.priceStars,
    userId: input.fromId,
    adminId: input.adminId,
    testMode: input.testMode,
  });
  if (input.totalAmount !== expectedAmount) return { ok: false, error: INVOICE_ERRORS.price };
  if (input.alreadyOwned) return { ok: false, error: INVOICE_ERRORS.owned };
  return { ok: true, productId: input.product.id, expectedAmount };
}
