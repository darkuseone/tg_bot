const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
const workerUrl = (process.env.WORKER_URL ?? "").replace(/\/$/, "");

if (!token || !workerUrl) {
  console.error("Need TELEGRAM_BOT_TOKEN and WORKER_URL in the environment.");
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

await api("setChatMenuButton", {
  menu_button: {
    type: "web_app",
    text: "Открыть",
    web_app: { url: `${workerUrl}/app` },
  },
});

const me = await api("getMe", {});
const menu = await api("getChatMenuButton", {});
console.log(
  JSON.stringify(
    {
      username: me.username,
      has_main_web_app: me.has_main_web_app === true,
      menu_type: menu.type ?? null,
      menu_text: menu.text ?? null,
      menu_url: menu.web_app?.url ?? null,
    },
    null,
    2,
  ),
);
