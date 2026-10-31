import { describe, expect, it } from "vitest";
import worker from "../src/index";

const env = {
  WEBHOOK_SECRET: "expected-secret",
  TELEGRAM_BOT_TOKEN: "test-token",
  ADMIN_ID: "42",
  TEST_MODE: "1",
  DB: {},
  ASSETS: { fetch: async () => new Response(null, { status: 404 }) },
} as unknown as Env;

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

describe("webhook entry", () => {
  it("answers a health check without secrets", async () => {
    const response = await worker.fetch(new Request("https://bot.example/"), env, ctx);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, service: "markus-brown" });
  });

  it("rejects a webhook with the wrong secret", async () => {
    const response = await worker.fetch(
      new Request("https://bot.example/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "wrong" },
        body: "{}",
      }),
      env,
      ctx,
    );
    expect(response.status).toBe(401);
  });

  it("rejects a webhook when the secret is not configured", async () => {
    const response = await worker.fetch(
      new Request("https://bot.example/webhook", {
        method: "POST",
        headers: { "X-Telegram-Bot-Api-Secret-Token": "expected-secret" },
        body: "{}",
      }),
      { ...env, WEBHOOK_SECRET: "" },
      ctx,
    );
    expect(response.status).toBe(401);
  });

  it("serves the mini app shell", async () => {
    const assets = {
      fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        if (path === "/app/index.html") return new Response("<!doctype html><h1>Привет, я Markus Brown</h1>");
        return new Response(null, { status: 404 });
      },
    };
    const response = await worker.fetch(
      new Request("https://bot.example/app"),
      { ...env, ASSETS: assets } as unknown as Env,
      ctx,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("Привет, я Markus Brown");
  });

  it("returns 404 for anything else", async () => {
    const response = await worker.fetch(new Request("https://bot.example/admin"), env, ctx);
    expect(response.status).toBe(404);
  });
});
