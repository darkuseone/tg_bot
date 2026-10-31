const PRODUCT = "pixelverse";
const SPARK_COLORS = [
  [255, 45, 85],
  [255, 45, 85],
  [139, 92, 246],
  [59, 130, 246],
];

const sparksCanvas = document.getElementById("sparks");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const lowPower = (navigator.hardwareConcurrency || 8) <= 4 || (navigator.connection && navigator.connection.saveData);
const sparkCount = lowPower ? 42 : 78;
const sparks = Array.from({ length: sparkCount }, () => makeSpark());
const bokeh = Array.from({ length: 4 }, () => ({
  x: Math.random(),
  y: Math.random(),
  r: 26 + Math.random() * 30,
  vy: 0.015 + Math.random() * 0.02,
  color: SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)],
}));
let sparkFrame = 0;
let sparkStamp = 0;

function makeSpark() {
  const color = SPARK_COLORS[Math.floor(Math.random() * SPARK_COLORS.length)];
  return {
    x: Math.random(),
    y: Math.random(),
    vx: (Math.random() - 0.5) * 0.04,
    vy: -(0.12 + Math.random() * 0.22),
    size: 1 + Math.random() * 1.5,
    flicker: Math.random() * Math.PI * 2,
    color,
  };
}

function resizeSparks() {
  const dpr = Math.min(window.devicePixelRatio || 1, 3);
  const width = sparksCanvas.clientWidth;
  const height = sparksCanvas.clientHeight;
  sparksCanvas.width = Math.max(1, Math.floor(width * dpr));
  sparksCanvas.height = Math.max(1, Math.floor(height * dpr));
  sparksCanvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}

function drawSparks(now) {
  const ctx = sparksCanvas.getContext("2d");
  const width = sparksCanvas.clientWidth;
  const height = sparksCanvas.clientHeight;
  const step = Math.min(0.05, (now - (sparkStamp || now)) / 1000 || 0.016);
  sparkStamp = now;
  ctx.clearRect(0, 0, width, height);
  ctx.globalCompositeOperation = "source-over";
  for (const orb of bokeh) {
    orb.y -= orb.vy * step;
    if (orb.y < -0.15) orb.y = 1.1;
    ctx.beginPath();
    ctx.fillStyle = `rgba(${orb.color[0]}, ${orb.color[1]}, ${orb.color[2]}, 0.14)`;
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 48;
    ctx.arc(orb.x * width, orb.y * height, orb.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalCompositeOperation = "lighter";
  for (const spark of sparks) {
    spark.x += spark.vx * step;
    spark.y += spark.vy * step;
    spark.flicker += step * 6;
    if (spark.y < -0.05) {
      spark.y = 1.02;
      spark.x = Math.random();
    }
    const fade = Math.max(0, Math.min(1, spark.y));
    const alpha = (0.35 + 0.45 * Math.abs(Math.sin(spark.flicker))) * fade;
    const x = spark.x * width;
    const y = spark.y * height;
    const [r, g, b] = spark.color;
    ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.fillStyle = ctx.strokeStyle;
    ctx.shadowColor = `rgba(${r}, ${g}, ${b}, ${alpha})`;
    ctx.shadowBlur = 8;
    ctx.lineWidth = spark.size;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - spark.vx * width * 0.08, y - spark.vy * height * 0.045);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, spark.size, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  ctx.globalCompositeOperation = "source-over";
}

function loopSparks(now) {
  drawSparks(now);
  if (!reduceMotion) sparkFrame = window.requestAnimationFrame(loopSparks);
}

if (reduceMotion) document.documentElement.classList.add("motion-off");

const home = document.getElementById("home");
const course = document.getElementById("course");
const paydock = document.getElementById("paydock");
const pay = document.getElementById("pay");
const openChat = document.getElementById("open-chat");
const payCopy = document.getElementById("pay-copy");
const files = document.getElementById("files");
const toast = document.getElementById("toast");
const preview = document.getElementById("preview");
let toastTimer = 0;

function telegram() {
  return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
}

function showToast(text) {
  toast.textContent = text;
  toast.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toast.hidden = true;
  }, 4200);
}

async function post(path, body) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return data;
}

function syncBack() {
  const tg = telegram();
  if (!tg || !tg.BackButton) return;
  if (home.hidden) tg.BackButton.show();
  else tg.BackButton.hide();
}

function showHome() {
  course.hidden = true;
  home.hidden = false;
  paydock.hidden = true;
  document.body.classList.remove("paying");
  syncBack();
  window.scrollTo(0, 0);
}

function showCourse(push) {
  home.hidden = true;
  course.hidden = false;
  paydock.hidden = false;
  document.body.classList.add("paying");
  if (push) history.pushState({ screen: "course" }, "");
  syncBack();
  window.scrollTo(0, 0);
}

function applyProduct(product) {
  if (!product) return;
  if (Array.isArray(product.files) && product.files.length > 0) {
    files.replaceChildren(
      ...product.files.map((name) => {
        const item = document.createElement("li");
        item.textContent = String(name);
        return item;
      }),
    );
  }
  if (product.owned) {
    files.classList.remove("locked");
    pay.hidden = true;
    openChat.hidden = false;
    payCopy.hidden = true;
    return;
  }
  files.classList.add("locked");
  pay.hidden = false;
  openChat.hidden = true;
  payCopy.hidden = false;
  pay.textContent = `Купить за ${product.invoiceStars} ⭐`;
}

async function refresh() {
  const tg = telegram();
  if (!tg || !tg.initData) return null;
  const data = await post("/api/session", { initData: tg.initData });
  if (!data || !data.ok) return null;
  const product = (data.products || []).find((item) => item.id === PRODUCT);
  applyProduct(product);
  return data;
}

async function pollOwned() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const data = await refresh();
    const product = data && (data.products || []).find((item) => item.id === PRODUCT);
    if (product && product.owned) return;
    await new Promise((resolve) => window.setTimeout(resolve, 700));
  }
  showToast("Оплата прошла. Если файлы не пришли в чат — нажми «Открыть в чате».");
}

document.getElementById("catalog").addEventListener("click", (event) => {
  const node = event.target instanceof Element ? event.target : event.target.parentElement;
  const card = node && node.closest("[data-product]");
  if (!card) return;
  const tg = telegram();
  if (tg && tg.HapticFeedback && typeof tg.HapticFeedback.impactOccurred === "function") {
    tg.HapticFeedback.impactOccurred("light");
  }
  showCourse(true);
});

document.getElementById("back").addEventListener("click", () => {
  if (history.state && history.state.screen === "course") history.back();
  else showHome();
});

window.addEventListener("popstate", () => {
  showHome();
});

pay.addEventListener("click", async () => {
  const tg = telegram();
  if (!tg || !tg.initData || typeof tg.openInvoice !== "function") {
    showToast("Оплата открывается в Telegram.");
    return;
  }
  pay.disabled = true;
  const data = await post("/api/invoice", { initData: tg.initData, productId: PRODUCT });
  if (!data || data.ok === false) {
    pay.disabled = false;
    showToast((data && data.error) || "Не получилось открыть счёт.");
    return;
  }
  if (data.owned) {
    pay.disabled = false;
    await refresh();
    return;
  }
  tg.openInvoice(data.url, (status) => {
    pay.disabled = false;
    if (status === "paid") void pollOwned();
  });
});

openChat.addEventListener("click", async () => {
  const tg = telegram();
  if (!tg || !tg.initData) {
    showToast("Открой приложение в Telegram.");
    return;
  }
  openChat.disabled = true;
  const data = await post("/api/open", { initData: tg.initData, productId: PRODUCT });
  openChat.disabled = false;
  if (!data || data.ok === false) {
    showToast((data && data.error) || "Не получилось прислать файлы.");
    return;
  }
  if (!data.count) {
    showToast("Файлы ещё не загружены. Напиши /paysupport.");
    return;
  }
  if (typeof tg.close === "function") tg.close();
});

function boot() {
  const tg = telegram();
  if (!tg || !tg.initData) preview.hidden = false;
  if (tg) {
    tg.ready();
    tg.expand();
    try {
      tg.setHeaderColor("#0b0b12");
      tg.setBackgroundColor("#0b0b12");
    } catch {
      /* older clients */
    }
    if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
    tg.BackButton.onClick(() => {
      if (history.state && history.state.screen === "course") history.back();
      else showHome();
    });
  }
  if (!reduceMotion) {
    resizeSparks();
    window.addEventListener("resize", resizeSparks);
    loopSparks(performance.now());
  }
  const opened = refresh();
  if (location.hash === `#${PRODUCT}`) showCourse(true);
  void opened.then((data) => {
    if (data && data.focusProductId === PRODUCT && home.hidden === false) showCourse(true);
  });
}

boot();
