import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const profile = JSON.parse(readFileSync(join(root, "..", "bot-profile.json"), "utf8"));
const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const secret = process.env.WEBHOOK_SECRET ?? "";
const workerUrl = (process.env.WORKER_URL ?? "").replace(/\/$/, "");

if (!token || !secret || !workerUrl) {
  console.error("Need TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET and WORKER_URL in the environment.");
  process.exit(1);
}

const api = async (method, body) => {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) {
    console.error(`${method} failed: ${data.error_code ?? response.status} ${data.description ?? ""}`);
    process.exit(1);
  }
  return data.result;
};

await api("setMyName", { name: profile.name });
await api("setMyShortDescription", { short_description: profile.short_description });
await api("setMyDescription", { description: profile.description });
await api("setMyCommands", { commands: profile.commands });
await api("setWebhook", {
  url: `${workerUrl}/webhook`,
  secret_token: secret,
  allowed_updates: ["message", "callback_query", "pre_checkout_query"],
  drop_pending_updates: false,
});
await api("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "Открыть",
    web_app: { url: `${workerUrl}/app` },
  },
});

const me = await api("getMe", {});
const hook = await api("getWebhookInfo", {});
const lastError = typeof hook.last_error_message === "string" ? hook.last_error_message : null;
console.log(
  JSON.stringify(
    {
      username: me.username,
      has_main_web_app: me.has_main_web_app === true,
      webhook_url: hook.url,
      pending_update_count: hook.pending_update_count,
      last_error_message: lastError,
      has_custom_certificate: hook.has_custom_certificate,
    },
    null,
    2,
  ),
);
