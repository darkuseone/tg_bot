import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { handleAppRequest } from "../src/mini-http";
import { openInChat, openMiniSession, requestInvoice, type MiniDeps } from "../src/mini-api";
import { readInitData } from "../src/webapp-auth";
import { MemoryRepo } from "./memory-repo";

const TOKEN = "test-token";
const NOW = new Date("2026-10-31T00:00:00.000Z");
const NOW_SEC = Math.floor(NOW.getTime() / 1000);

function sign(token: string, dataCheck: string): string {
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  return createHmac("sha256", secret).update(dataCheck).digest("hex");
}

function initData(fields: Record<string, string>, token = TOKEN): string {
  const dataCheck = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const params = new URLSearchParams({ ...fields, hash: sign(token, dataCheck) });
  return params.toString();
}

function userData(id: number): string {
  return JSON.stringify({ id, first_name: "Тест", username: "tester" });
}

function deps(repo: MemoryRepo, calls: { method: string; body: Record<string, unknown> }[] = []): MiniDeps {
  return {
    adminId: "42",
    testMode: "1",
    repo,
    now: () => NOW,
    callTelegram: async (method, body) => {
      calls.push({ method, body });
      if (method === "createInvoiceLink") return "https://t.me/$invoice";
      return { message_id: 1 };
    },
  };
}

describe("mini app copy", () => {
  it("keeps the two home lines, the real photo, and the course points", () => {
    const html = readFileSync("assets/app/index.html", "utf8");
    const js = readFileSync("assets/app/app.js", "utf8");
    const css = readFileSync("assets/app/app.css", "utf8");
    const ui = `${html}\n${js}\n${css}`;
    const home = html.split('id="course"')[0] ?? html;
    const greeting = html.replace(/&nbsp;/g, " ").replace(/<[^>]+>/g, "");
    expect(greeting).toContain("Привет, я Markus Brown 👋");
    expect(greeting).toContain("ИИ не магия, а суперсила.");
    expect(greeting).toContain("Забирай свою 🔥");
    expect(greeting).toContain("Курсы 🚀");
    expect(css).toContain(".home-line");
    expect(css).not.toMatch(/\.courses\s*\{[^}]*font-size:\s*16px/);
    expect(home).not.toContain("990");
    expect(html).toContain("marcus-photo.jpg");
    expect(html).toContain("pixelverse-tv.jpg");
    expect(html).not.toContain("pixelated");
    expect(ui).not.toContain("сезон коротких серий");
    expect(ui).not.toContain("Добро пожаловать в мой мир ИИ");
    expect(ui).not.toContain("anthropic");
    expect(html).not.toContain("<video");
    expect(html).toContain('id="sparks"');
    expect(js).toContain("requestAnimationFrame");
    expect(js).toContain("139, 92, 246");
    expect(js).toContain("59, 130, 246");
    expect(css).toContain("-webkit-backdrop-filter");
    expect(css).toMatch(/\.home-line\s*\{[^}]*font-size:\s*18px/);
    expect(css).toMatch(/white-space:\s*nowrap/);
    expect(css).toMatch(/\.home-line\s*\{[^}]*font-weight:\s*800/);
    expect(html).toContain("Своя мультстудия с телефона или с компьютера");
    expect(html).toContain("Любой сериал на любую тему: твоя задумка, твои герои");
    expect(html).toContain("Площадки платят по своим правилам: реклама в Shorts, Reels и TikTok");
    expect(html).toContain("Бренды и интеграции, когда сериал узнают");
    expect(html).toContain("Свои продукты и мультики на заказ");
    expect(html).toContain("Купить за 990 ⭐");
    expect(html).toContain("Открыть в чате");
    expect(html).toContain("Ты готов погрузиться в мир ИИ?");
    expect(html).toContain("0. Как всё устроено");
    expect(js).toContain("openInvoice");
    expect(js).not.toContain("file_id");
    expect(html).not.toContain("<a ");
  });
});

describe("init data", () => {
  it("accepts a signed telegram user and rejects tampering or expiry", async () => {
    const fields = { auth_date: String(NOW_SEC), user: userData(7), start_param: "tiktok" };
    const identity = await readInitData(initData(fields), TOKEN, NOW_SEC);
    expect(identity).toMatchObject({ id: 7, username: "tester", firstName: "Тест", startParam: "tiktok" });
    const tampered = initData(fields).replace("tiktok", "youtube");
    expect(await readInitData(tampered, TOKEN, NOW_SEC)).toBeNull();
    expect(await readInitData(initData(fields), "other-token", NOW_SEC)).toBeNull();
    expect(await readInitData(initData({ ...fields, auth_date: String(NOW_SEC - 90000) }), TOKEN, NOW_SEC)).toBeNull();
    expect(await readInitData("", TOKEN, NOW_SEC)).toBeNull();
  });
});

describe("mini app api", () => {
  it("prices the invoice at 990 and at 1 star for the owner, and skips a second invoice", async () => {
    const repo = new MemoryRepo();
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const api = deps(repo, calls);
    const buyer = { id: 7, username: "buyer", firstName: "Покупатель", startParam: "tiktok" };
    const session = await openMiniSession(api, buyer);
    expect(session.products[0]).toMatchObject({ id: "pixelverse", invoiceStars: 990, owned: false });
    expect(repo.users.get(7)?.source).toBe("tiktok");
    const link = await requestInvoice(api, buyer, "pixelverse");
    expect(link).toEqual({ ok: true, url: "https://t.me/$invoice" });
    expect(calls[0]).toMatchObject({
      method: "createInvoiceLink",
      body: { currency: "XTR", provider_token: "", prices: [{ label: "Курс", amount: 990 }] },
    });

    const owner = { id: 42, username: null, firstName: "Автор", startParam: null };
    const ownerLink = await requestInvoice(api, owner, "pixelverse");
    expect(ownerLink).toEqual({ ok: true, url: "https://t.me/$invoice" });
    expect(calls[1]?.body.prices).toEqual([{ label: "Курс", amount: 1 }]);

    repo.purchases.push({
      userId: 42,
      product: "pixelverse",
      chargeId: "chg",
      amount: 1,
      refunded: false,
      delivered: true,
      payload: "v1",
      purchasedAt: NOW.toISOString(),
    });
    const before = calls.length;
    const again = await requestInvoice(api, owner, "pixelverse");
    expect(again).toEqual({ ok: true, owned: true });
    expect(calls).toHaveLength(before);
  });

  it("sends course files to the chat without exposing file ids", async () => {
    const repo = new MemoryRepo();
    await repo.replaceProductFiles("pixelverse", [
      { fileId: "secret-file", fileName: "course.pdf", caption: "Курс", kind: "document" },
      { fileId: "secret-video", fileName: "promo.mp4", caption: "Промо", kind: "video" },
    ]);
    repo.purchases.push({
      userId: 7,
      product: "pixelverse",
      chargeId: "chg",
      amount: 990,
      refunded: false,
      delivered: true,
      payload: "v1",
      purchasedAt: NOW.toISOString(),
    });
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const identity = { id: 7, username: null, firstName: null, startParam: "pixelverse_youtube" };
    const session = await openMiniSession(deps(repo), identity);
    expect(session.focusProductId).toBe("pixelverse");
    expect(session.products[0]?.owned).toBe(true);
    expect(session.products[0]?.files).toEqual(["Курс"]);
    expect(JSON.stringify(session)).not.toContain("secret-file");
    const opened = await openInChat(deps(repo, calls), identity, "pixelverse");
    expect(opened).toEqual({ ok: true, count: 1 });
    expect(calls).toEqual([
      { method: "sendDocument", body: { chat_id: 7, document: "secret-file", caption: "Курс" } },
    ]);
    expect(JSON.stringify(opened)).not.toContain("secret-file");
  });
});

describe("mini app http", () => {
  it("rejects a session without init data and does not invoice an owned course", async () => {
    const repo = new MemoryRepo();
    repo.purchases.push({
      userId: 7,
      product: "pixelverse",
      chargeId: "chg",
      amount: 990,
      refunded: false,
      delivered: true,
      payload: "v1",
      purchasedAt: NOW.toISOString(),
    });
    const calls: { method: string; body: Record<string, unknown> }[] = [];
    const hooks = {
      assets: { fetch: async () => new Response(null, { status: 404 }) },
      runtime: () => ({ ...deps(repo, calls), token: TOKEN }),
    };
    const denied = await handleAppRequest(
      new Request("https://bot.example/api/session", {
        method: "POST",
        body: JSON.stringify({ initData: "hash=nope" }),
      }),
      hooks,
    );
    expect(denied?.status).toBe(401);

    const fields = { auth_date: String(NOW_SEC), user: userData(7) };
    const invoice = await handleAppRequest(
      new Request("https://bot.example/api/invoice", {
        method: "POST",
        body: JSON.stringify({ initData: initData(fields), productId: "pixelverse" }),
      }),
      hooks,
    );
    expect(invoice?.status).toBe(200);
    expect(await invoice?.json()).toEqual({ ok: true, owned: true });
    expect(calls).toEqual([]);
  });
});
