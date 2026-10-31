import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import profile from "../bot-profile.json";
import { getProduct, listVisibleProducts } from "../src/catalog";
import { INVOICE_ERRORS, checkInvoice } from "../src/invoice";
import { buildInvoicePayload } from "../src/payload";
import { applySuccessfulPayment } from "../src/payments";
import { priceForUser } from "../src/pricing";
import { parseStartPayload } from "../src/start";
import { formatStats } from "../src/stats";
import {
  INVOICE_DESCRIPTION,
  INVOICE_TITLE,
  PAYSUPPORT_TEXT,
  PIXEL_CHECKOUT,
  PIXEL_HOME,
  STAR_PRICE,
  START_TEXT,
  TERMS_TEXT,
} from "../src/texts";
import { verifyWebhookSecret } from "../src/webhook-auth";
import { drainBroadcastQueue } from "../src/broadcast";
import { MemoryRepo } from "./memory-repo";

const product = getProduct("pixelverse");
if (!product) throw new Error("pixelverse missing");

describe("price", () => {
  it("charges the public price and 1 star for the owner in test mode", () => {
    expect(product?.priceStars).toBe(STAR_PRICE);
    expect(STAR_PRICE).toBe(990);
    expect(priceForUser({ publicPrice: 990, userId: 7, adminId: "42", testMode: "1" })).toBe(990);
    expect(priceForUser({ publicPrice: 990, userId: 42, adminId: " 42 ", testMode: "1" })).toBe(1);
    expect(priceForUser({ publicPrice: 990, userId: 42, adminId: "42", testMode: "0" })).toBe(990);
    expect(priceForUser({ publicPrice: 990, userId: 42, adminId: "42", testMode: undefined })).toBe(990);
  });
});

describe("checkInvoice", () => {
  const base = {
    currency: "XTR",
    fromId: 7,
    adminId: "42",
    testMode: "0",
    product,
    alreadyOwned: false,
  };

  it("accepts a matching stars invoice and rejects a different amount", () => {
    const payload = buildInvoicePayload("pixelverse", 7, 1_700_000_000_000);
    expect(checkInvoice({ ...base, payload, totalAmount: 990 })).toEqual({
      ok: true,
      productId: "pixelverse",
      expectedAmount: 990,
    });
    expect(checkInvoice({ ...base, payload, totalAmount: 1 })).toMatchObject({
      ok: false,
      error: INVOICE_ERRORS.price,
    });
  });

  it("uses the same 1-star rule for the owner", () => {
    const payload = buildInvoicePayload("pixelverse", 42, 1_700_000_000_000);
    const owner = { ...base, fromId: 42, testMode: "1" };
    expect(checkInvoice({ ...owner, payload, totalAmount: 1 }).ok).toBe(true);
    expect(checkInvoice({ ...owner, payload, totalAmount: 990 })).toMatchObject({
      ok: false,
      error: INVOICE_ERRORS.price,
    });
  });

  it("rejects a bad payload, another user, the wrong currency, and a repeat purchase", () => {
    const payload = buildInvoicePayload("pixelverse", 7, 1);
    expect(checkInvoice({ ...base, payload: "nope", totalAmount: 990 })).toMatchObject({
      error: INVOICE_ERRORS.payload,
    });
    expect(checkInvoice({ ...base, payload, totalAmount: 990, fromId: 8 })).toMatchObject({
      error: INVOICE_ERRORS.user,
    });
    expect(checkInvoice({ ...base, payload, totalAmount: 990, currency: "USD" })).toMatchObject({
      error: INVOICE_ERRORS.currency,
    });
    expect(checkInvoice({ ...base, payload, totalAmount: 990, alreadyOwned: true })).toMatchObject({
      error: INVOICE_ERRORS.owned,
    });
    expect(checkInvoice({ ...base, payload, totalAmount: 990, product: undefined })).toMatchObject({
      error: INVOICE_ERRORS.product,
    });
  });
});

describe("successful payment", () => {
  const now = "2026-10-31T00:00:00.000Z";

  function input(chargeId: string, amount = 990) {
    return {
      chargeId,
      fromId: 7,
      currency: "XTR",
      totalAmount: amount,
      payload: buildInvoicePayload("pixelverse", 7, 1_700_000_000_000),
      adminId: "42",
      testMode: "0",
      now,
    };
  }

  it("grants once and treats the same charge as a duplicate", async () => {
    const repo = new MemoryRepo();
    const first = await applySuccessfulPayment(repo, input("chg-1"));
    const second = await applySuccessfulPayment(repo, input("chg-1"));
    expect(first).toMatchObject({ type: "granted", productId: "pixelverse", amount: 990 });
    expect(second).toMatchObject({ type: "duplicate", previous: "granted", delivered: false });
    expect(repo.purchases).toHaveLength(1);
    await repo.markDelivered("chg-1");
    const third = await applySuccessfulPayment(repo, input("chg-1"));
    expect(third).toMatchObject({ type: "duplicate", delivered: true });
    expect(repo.purchases).toHaveLength(1);
  });

  it("does not grant a second active purchase of the same product", async () => {
    const repo = new MemoryRepo();
    await applySuccessfulPayment(repo, input("chg-1"));
    const again = await applySuccessfulPayment(repo, input("chg-2"));
    expect(again).toMatchObject({ type: "already_owned", productId: "pixelverse" });
    expect(repo.purchases).toHaveLength(1);
  });

  it("rejects the wrong amount without a purchase", async () => {
    const repo = new MemoryRepo();
    const result = await applySuccessfulPayment(repo, input("chg-x", 1));
    expect(result).toMatchObject({ type: "rejected", error: INVOICE_ERRORS.price });
    expect(repo.purchases).toHaveLength(0);
    const retry = await applySuccessfulPayment(repo, input("chg-x", 1));
    expect(retry).toMatchObject({ type: "duplicate", previous: "rejected" });
  });

  it("allows a new purchase after a refund", async () => {
    const repo = new MemoryRepo();
    await applySuccessfulPayment(repo, input("chg-1"));
    expect(await repo.markRefunded("chg-1")).toBe(true);
    expect(await repo.listActivePurchases(7)).toEqual([]);
    const again = await applySuccessfulPayment(repo, input("chg-2"));
    expect(again.type).toBe("granted");
    expect(await repo.hasActivePurchase(7, "pixelverse")).toBe(true);
  });
});

describe("start links and copy", () => {
  it("keeps source tags and opens a product from a deep link", () => {
    expect(parseStartPayload("tiktok", ["pixelverse"])).toEqual({ source: "tiktok", productId: null });
    expect(parseStartPayload("pixelverse_tiktok", ["pixelverse"])).toEqual({
      source: "tiktok",
      productId: "pixelverse",
    });
    expect(parseStartPayload("pixelverse", ["pixelverse"])).toEqual({
      source: "pixelverse",
      productId: "pixelverse",
    });
    expect(parseStartPayload("bad tag", ["pixelverse"]).source).toBeNull();
  });

  it("uses the mini app greeting, the course text, and generalized terms", () => {
    expect(START_TEXT).toBe("Привет, я Markus Brown\nИИ не магия, а суперсила. Забирай свою");
    expect(START_TEXT).not.toContain("Добро пожаловать");
    expect(PIXEL_HOME.startsWith("Привет! Это PIXEL VERSE")).toBe(true);
    expect(PIXEL_CHECKOUT).toBe("Ты готов погрузиться в мир ИИ?\nХватит почты и телефона или компьютера.");
    expect(PIXEL_CHECKOUT).not.toContain("anthropic");
    expect(TERMS_TEXT).toContain("Цифровые продукты");
    expect(TERMS_TEXT).not.toMatch(/курс/i);
    expect(PAYSUPPORT_TEXT).toContain("/mycourse");
    expect(listVisibleProducts().map((item) => item.button)).toEqual(["👾 PIXEL VERSE"]);
  });

  it("fits Telegram profile limits", () => {
    expect(profile.short_description.length).toBeLessThanOrEqual(120);
    expect(profile.description.length).toBeLessThanOrEqual(512);
    expect(INVOICE_TITLE.length).toBeLessThanOrEqual(32);
    expect(INVOICE_DESCRIPTION.length).toBeLessThanOrEqual(255);
    expect(START_TEXT.length).toBeLessThanOrEqual(1024);
    expect(PIXEL_HOME.length).toBeLessThanOrEqual(1024);
    expect(profile.commands.map((command) => command.description)).toEqual([
      "Начать",
      "Мои покупки",
      "Помощь с оплатой",
      "Условия",
    ]);
  });

  it("does not mention removed country names", () => {
    const files = walk("src").concat(["README.md", "bot-profile.json"]);
    const banned = /росси|беларус|belarus|russia/i;
    for (const file of files) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(banned);
    }
  });
});

describe("stats and broadcast", () => {
  it("formats conversion and source rows", () => {
    const text = formatStats({
      starts: 4,
      purchases: 1,
      bySource: [
        { source: "tiktok", count: 3 },
        { source: "", count: 1 },
      ],
      byProduct: [{ product: "pixelverse", count: 1 }],
    });
    expect(text).toContain("Конверсия: 25%");
    expect(text).toContain("• tiktok — 3");
    expect(text).toContain("• без метки — 1");
    expect(text).toContain("• pixelverse — 1");
  });

  it("stops a batch on retry and leaves the rest pending", async () => {
    const jobs = [
      { id: 1, userId: 1, text: "a" },
      { id: 2, userId: 2, text: "b" },
      { id: 3, userId: 3, text: "c" },
    ];
    const finished: { id: number; status: string }[] = [];
    const sent: number[] = [];
    const result = await drainBroadcastQueue({
      take: async () => jobs,
      finish: async (id, status) => {
        finished.push({ id, status });
      },
      send: async (userId) => {
        sent.push(userId);
        return userId === 2 ? "retry" : "sent";
      },
    });
    expect(result).toEqual({ sent: 1, failed: 0, stopped: true });
    expect(sent).toEqual([1, 2]);
    expect(finished).toEqual([
      { id: 1, status: "sent" },
      { id: 2, status: "pending" },
    ]);
  });
});

describe("webhook secret", () => {
  it("accepts only the expected secret", async () => {
    expect(await verifyWebhookSecret("right-secret", "right-secret")).toBe(true);
    expect(await verifyWebhookSecret("wrong-secret", "right-secret")).toBe(false);
    expect(await verifyWebhookSecret("", "right-secret")).toBe(false);
    expect(await verifyWebhookSecret("right-secret", "")).toBe(false);
    expect(await verifyWebhookSecret("right-secret-extra", "right-secret")).toBe(false);
  });
});

describe("purchase table", () => {
  it("keeps charge ids unique and allows one active purchase", () => {
    const db = new DatabaseSync(":memory:");
    db.exec(readFileSync("migrations/0001_init.sql", "utf8"));
    const insert = db.prepare(
      `INSERT INTO purchases (user_id, product, charge_id, amount, purchased_at, payload, refunded, delivered)
       VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
    );
    insert.run(7, "pixelverse", "chg-1", 990, "2026-10-31", "payload");
    expect(() => insert.run(8, "other", "chg-1", 990, "2026-10-31", "payload")).toThrow(/charge_id/);
    expect(() => insert.run(7, "pixelverse", "chg-2", 990, "2026-10-31", "payload")).toThrow(/user_id, purchases.product/);
    db.prepare(`UPDATE purchases SET refunded = 1 WHERE charge_id = ?`).run("chg-1");
    insert.run(7, "pixelverse", "chg-3", 990, "2026-10-31", "payload");
    const active = db.prepare(`SELECT COUNT(*) AS n FROM purchases WHERE refunded = 0`).get() as { n: number };
    expect(active.n).toBe(1);
  });
});

function walk(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...walk(path));
    else if (entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}
