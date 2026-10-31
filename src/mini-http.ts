import { log, safeError } from "./log";
import { openInChat, openMiniSession, requestInvoice, type MiniDeps } from "./mini-api";
import type { Repo } from "./repo";
import { readInitData } from "./webapp-auth";

const CSP = [
  "default-src 'self'",
  "script-src 'self' https://telegram.org",
  "style-src 'self'",
  "font-src 'self'",
  "img-src 'self'",
  "connect-src 'self' https://telegram.org https://*.telegram.org",
  "base-uri 'none'",
  "object-src 'none'",
].join("; ");

const FILES: Record<string, { name: string; type: string; cache: string }> = {
  "/app": { name: "app/index.html", type: "text/html; charset=utf-8", cache: "no-cache, no-store, must-revalidate" },
  "/app/": { name: "app/index.html", type: "text/html; charset=utf-8", cache: "no-cache, no-store, must-revalidate" },
  "/app/app.css": { name: "app/app.css", type: "text/css; charset=utf-8", cache: "no-cache, no-store, must-revalidate" },
  "/app/app.js": { name: "app/app.js", type: "text/javascript; charset=utf-8", cache: "no-cache, no-store, must-revalidate" },
  "/media/brand-cover.jpg": { name: "brand-cover.jpg", type: "image/jpeg", cache: "public, max-age=3600" },
  "/media/marcus-photo.jpg": { name: "marcus-photo.jpg", type: "image/jpeg", cache: "public, max-age=3600" },
  "/media/pixelverse-cover.jpg": { name: "pixelverse-cover.jpg", type: "image/jpeg", cache: "public, max-age=3600" },
  "/media/pixelverse-tv.jpg": { name: "pixelverse-tv.jpg", type: "image/jpeg", cache: "public, max-age=3600" },
  "/media/press-start-2p.woff2": { name: "press-start-2p.woff2", type: "font/woff2", cache: "public, max-age=86400" },
};

export interface AppAssets {
  fetch(request: Request): Promise<Response>;
}

export interface AppRuntime {
  token: string;
  adminId: string;
  testMode: string;
  repo: Repo;
  now: () => Date;
  callTelegram: (method: string, body: Record<string, unknown>) => Promise<unknown>;
}

export interface AppHooks {
  assets: AppAssets;
  runtime: () => AppRuntime;
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  const raw = await request.text();
  if (raw.length > 20_000) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function field(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  return typeof value === "string" ? value : "";
}

async function serveAsset(assets: AppAssets, file: { name: string; type: string; cache: string }): Promise<Response> {
  const upstream = await assets.fetch(new Request(`https://assets.local/${file.name}`));
  if (!upstream.ok) return new Response("not found", { status: 404 });
  const headers = new Headers();
  headers.set("content-type", file.type);
  headers.set("cache-control", file.cache);
  headers.set("x-content-type-options", "nosniff");
  if (file.type.startsWith("text/html")) {
    headers.set("content-security-policy", CSP);
    headers.set("referrer-policy", "no-referrer");
  }
  return new Response(upstream.body, { status: 200, headers });
}

export async function handleAppRequest(request: Request, hooks: AppHooks): Promise<Response | null> {
  const url = new URL(request.url);
  const file = FILES[url.pathname];
  if (request.method === "GET" && file) return serveAsset(hooks.assets, file);
  if (url.pathname !== "/api/session" && url.pathname !== "/api/invoice" && url.pathname !== "/api/open") {
    return null;
  }
  if (request.method !== "POST") return json({ ok: false, error: "Метод не поддерживается." }, 405);
  const body = await readBody(request);
  if (!body) return json({ ok: false, error: "Не понял запрос." }, 400);
  const runtime = hooks.runtime();
  const identity = await readInitData(field(body, "initData"), runtime.token, Math.floor(runtime.now().getTime() / 1000));
  if (!identity) return json({ ok: false, error: "Открой приложение в Telegram." }, 401);
  const deps: MiniDeps = {
    adminId: runtime.adminId,
    testMode: runtime.testMode,
    repo: runtime.repo,
    now: runtime.now,
    callTelegram: runtime.callTelegram,
  };
  try {
    if (url.pathname === "/api/session") return json({ ok: true, ...(await openMiniSession(deps, identity)) });
    const productId = field(body, "productId");
    if (url.pathname === "/api/invoice") return json(await requestInvoice(deps, identity, productId));
    return json(await openInChat(deps, identity, productId));
  } catch (error) {
    log("error", "mini app failed", { error: safeError(error) });
    return json({ ok: false, error: "Что-то пошло не так. Попробуй ещё раз." }, 500);
  }
}
