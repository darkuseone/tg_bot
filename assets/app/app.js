const FACE = { sx: 300, sy: 630, size: 460 };
const PRODUCT = "pixelverse";

const universe = document.getElementById("universe");
const portrait = document.getElementById("portrait");
const home = document.getElementById("home");
const course = document.getElementById("course");
const paydock = document.getElementById("paydock");
const pay = document.getElementById("pay");
const openChat = document.getElementById("open-chat");
const payCopy = document.getElementById("pay-copy");
const files = document.getElementById("files");
const toast = document.getElementById("toast");
const preview = document.getElementById("preview");

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const particles = Array.from({ length: 120 }, () => spawn(true));
const filaments = Array.from({ length: 16 }, (_, index) => index);
let frame = 0;
let toastTimer = 0;

function telegram() {
  return window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
}

function spawn(randomAge) {
  const life = 2.6 + Math.random() * 3.4;
  return {
    angle: Math.random() * Math.PI * 2,
    speed: 48 + Math.random() * 170,
    drift: (Math.random() - 0.5) * 0.7,
    life,
    age: randomAge ? Math.random() * life : 0,
    size: Math.random() < 0.14 ? 2.2 + Math.random() * 2.2 : 0.7 + Math.random() * 1.3,
    hot: Math.random() < 0.22,
  };
}

function resizeUniverse() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const width = universe.clientWidth;
  const height = universe.clientHeight;
  universe.width = Math.max(1, Math.floor(width * dpr));
  universe.height = Math.max(1, Math.floor(height * dpr));
  const ctx = universe.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function origin() {
  const width = universe.clientWidth;
  const height = universe.clientHeight;
  if (!home.hidden) {
    const rect = portrait.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, height };
  }
  return { x: width / 2, y: Math.min(140, height * 0.22), height };
}

function drawUniverse(now) {
  const ctx = universe.getContext("2d");
  const width = universe.clientWidth;
  const height = universe.clientHeight;
  const point = origin();
  const seconds = now / 1000;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#070103";
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(point.x, point.y, 8, point.x, point.y, Math.max(width, height) * 0.9);
  glow.addColorStop(0, "rgba(255, 24, 42, 0.5)");
  glow.addColorStop(0.42, "rgba(110, 0, 16, 0.24)");
  glow.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const reach = Math.max(width, height) * 0.72;
  for (const index of filaments) {
    const life = (seconds * 0.28 + index * 0.063) % 1;
    const angle = (index / filaments.length) * Math.PI * 2 + Math.sin(seconds * 0.35 + index) * 0.18;
    const length = reach * (0.28 + life * 0.8);
    ctx.beginPath();
    ctx.moveTo(point.x, point.y);
    const steps = 7;
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      const local = length * t;
      const wobble = Math.sin(t * 6 + seconds * 1.6 + index) * (6 + t * 22);
      const x = point.x + Math.cos(angle) * local + Math.cos(angle + Math.PI / 2) * wobble;
      const y = point.y + Math.sin(angle) * local + Math.sin(angle + Math.PI / 2) * wobble;
      ctx.lineTo(x, y);
    }
    const alpha = 0.15 + (1 - life) * 0.55;
    ctx.strokeStyle = `rgba(255, ${42 + (index % 4) * 18}, 58, ${alpha})`;
    ctx.lineWidth = 1.15;
    ctx.stroke();
  }

  const maxRing = Math.max(width, height) * 0.62;
  for (const shift of [0, 0.5]) {
    const t = (seconds / 3.1 + shift) % 1;
    ctx.beginPath();
    ctx.arc(point.x, point.y, 58 + t * maxRing, 0, Math.PI * 2);
    const fade = t < 0.72 ? 0.72 : ((1 - t) / 0.28) * 0.72;
    ctx.strokeStyle = `rgba(255, 46, 62, ${fade})`;
    ctx.lineWidth = 0.8 + (1 - t) * 2.4;
    ctx.stroke();
  }

  const step = reduceMotion ? 0.016 : Math.min(0.05, (now - (drawUniverse.last || now)) / 1000 || 0.016);
  drawUniverse.last = now;
  for (const particle of particles) {
    particle.age += reduceMotion ? 0 : step;
    if (particle.age > particle.life) Object.assign(particle, spawn(false));
    const progress = particle.age / particle.life;
    const distance = particle.speed * particle.age;
    const angle = particle.angle + particle.drift * progress;
    const x = point.x + Math.cos(angle) * distance;
    const y = point.y + Math.sin(angle) * distance;
    const alpha = 1 - progress;
    ctx.beginPath();
    ctx.arc(x, y, particle.size, 0, Math.PI * 2);
    ctx.fillStyle = particle.hot
      ? `rgba(255, 214, 214, ${alpha})`
      : `rgba(255, ${48 + Math.floor((1 - progress) * 40)}, 62, ${alpha})`;
    ctx.fill();
  }

  const vignette = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.75);
  vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
  vignette.addColorStop(1, "rgba(0, 0, 0, 0.55)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

let running = true;

function loop(now) {
  drawUniverse(now);
  if (running && !reduceMotion) frame = window.requestAnimationFrame(loop);
}

document.addEventListener("visibilitychange", () => {
  running = !document.hidden;
  if (running && !reduceMotion) frame = window.requestAnimationFrame(loop);
});

function paintPortrait() {
  const image = new Image();
  image.onload = () => {
    const ctx = portrait.getContext("2d");
    portrait.width = 56;
    portrait.height = 56;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(image, FACE.sx, FACE.sy, FACE.size, FACE.size, 0, 0, 56, 56);
  };
  image.src = "/media/brand-cover.jpg";
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
  pay.textContent = `Оплатить ${product.invoiceStars} ⭐`;
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
  const card = event.target.closest("[data-product]");
  if (!card) return;
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
      tg.setHeaderColor("#070103");
      tg.setBackgroundColor("#070103");
    } catch {
      /* older clients */
    }
    if (typeof tg.disableVerticalSwipes === "function") tg.disableVerticalSwipes();
    tg.BackButton.onClick(() => {
      if (history.state && history.state.screen === "course") history.back();
      else showHome();
    });
  }
  paintPortrait();
  resizeUniverse();
  window.addEventListener("resize", resizeUniverse);
  loop(performance.now());
  const opened = refresh();
  if (location.hash === `#${PRODUCT}`) showCourse(true);
  void opened.then((data) => {
    if (data && data.focusProductId === PRODUCT && home.hidden === false) showCourse(true);
  });
}

boot();
