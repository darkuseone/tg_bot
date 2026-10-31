import { getProduct, listVisibleProducts } from "./catalog";
import { log, safeError } from "./log";
import { buildInvoicePayload } from "./payload";
import { priceForUser } from "./pricing";
import type { Repo, StoredFile } from "./repo";
import { parseStartPayload } from "./start";
import { FILE_CAPTIONS } from "./texts";
import type { WebAppIdentity } from "./webapp-auth";

export interface MiniDeps {
  adminId: string;
  testMode: string;
  repo: Repo;
  now: () => Date;
  callTelegram: (method: string, body: Record<string, unknown>) => Promise<unknown>;
}

export interface MiniProductState {
  id: string;
  invoiceStars: number;
  owned: boolean;
  files: string[];
}

export interface MiniSession {
  focusProductId: string | null;
  products: MiniProductState[];
}

export type InvoiceResult = { ok: true; owned: true } | { ok: true; url: string } | { ok: false; error: string };

export type OpenResult = { ok: true; count: number } | { ok: false; error: string };

function fileLabels(files: StoredFile[]): string[] {
  const docs = files.filter((file) => file.kind === "document");
  if (docs.length === 0) return [...FILE_CAPTIONS];
  return docs.map((file, index) => file.caption || file.fileName || FILE_CAPTIONS[index] || "Файл");
}

export async function openMiniSession(deps: MiniDeps, identity: WebAppIdentity): Promise<MiniSession> {
  const now = deps.now().toISOString();
  await deps.repo.saveUser({
    id: identity.id,
    username: identity.username,
    firstName: identity.firstName,
    now,
  });
  const parsed = parseStartPayload(
    identity.startParam ?? undefined,
    listVisibleProducts().map((product) => product.id),
  );
  if (parsed.source) await deps.repo.setSourceIfEmpty(identity.id, parsed.source);
  const products: MiniProductState[] = [];
  for (const product of listVisibleProducts()) {
    const owned = await deps.repo.hasActivePurchase(identity.id, product.id);
    const files = await deps.repo.listProductFiles(product.id);
    products.push({
      id: product.id,
      invoiceStars: priceForUser({
        publicPrice: product.priceStars,
        userId: identity.id,
        adminId: deps.adminId,
        testMode: deps.testMode,
      }),
      owned,
      files: fileLabels(files),
    });
  }
  const focus = parsed.productId ? getProduct(parsed.productId) : undefined;
  return {
    focusProductId: focus && !focus.hidden ? focus.id : null,
    products,
  };
}

export async function requestInvoice(
  deps: MiniDeps,
  identity: WebAppIdentity,
  productId: string,
): Promise<InvoiceResult> {
  const product = getProduct(productId);
  if (!product || product.hidden) return { ok: false, error: "Этого продукта нет." };
  if (await deps.repo.hasActivePurchase(identity.id, product.id)) return { ok: true, owned: true };
  const amount = priceForUser({
    publicPrice: product.priceStars,
    userId: identity.id,
    adminId: deps.adminId,
    testMode: deps.testMode,
  });
  try {
    const result = await deps.callTelegram("createInvoiceLink", {
      title: product.invoiceTitle,
      description: product.invoiceDescription,
      payload: buildInvoicePayload(product.id, identity.id, deps.now().getTime()),
      provider_token: "",
      currency: "XTR",
      prices: [{ label: product.invoiceLabel, amount }],
    });
    if (typeof result !== "string" || !result.startsWith("https://")) {
      return { ok: false, error: "Не получилось открыть счёт. Попробуй ещё раз." };
    }
    return { ok: true, url: result };
  } catch (error) {
    log("error", "invoice link failed", { error: safeError(error) });
    return { ok: false, error: "Не получилось открыть счёт. Попробуй ещё раз." };
  }
}

export async function openInChat(
  deps: MiniDeps,
  identity: WebAppIdentity,
  productId: string,
): Promise<OpenResult> {
  const product = getProduct(productId);
  if (!product || product.hidden) return { ok: false, error: "Этого продукта нет." };
  if (!(await deps.repo.hasActivePurchase(identity.id, product.id))) {
    return { ok: false, error: "Сначала оплати курс." };
  }
  const docs = (await deps.repo.listProductFiles(product.id)).filter((file) => file.kind === "document");
  try {
    for (const doc of docs) {
      await deps.callTelegram("sendDocument", {
        chat_id: identity.id,
        document: doc.fileId,
        ...(doc.caption ? { caption: doc.caption } : {}),
      });
    }
  } catch (error) {
    log("error", "open in chat failed", { error: safeError(error) });
    return { ok: false, error: "Не получилось прислать файлы. Напиши /paysupport." };
  }
  return { ok: true, count: docs.length };
}
