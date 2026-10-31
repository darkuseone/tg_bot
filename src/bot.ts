import { Bot, GrammyError, InlineKeyboard, type Context } from "grammy";
import type { UserFromGetMe } from "grammy/types";
import { miniAppUrl } from "./app-url";
import { getProduct, listAllProducts, productIds, type Product } from "./catalog";
import { log, safeError } from "./log";
import { parseInvoicePayload } from "./payload";
import { applySuccessfulPayment, type SuccessResult } from "./payments";
import { checkInvoice } from "./invoice";
import type { Repo, StoredFile } from "./repo";
import { formatStats } from "./stats";
import { parseStartPayload } from "./start";
import { MAIN_IMAGE_SLOT, PAYSUPPORT_TEXT, START_TEXT, TERMS_TEXT } from "./texts";

export interface BotDeps {
  token: string;
  adminId: string;
  testMode: string;
  appUrl: string;
  repo: Repo;
  now: () => Date;
}

interface StagedFile {
  fileId: string;
  fileName: string | null;
  caption: string | null;
  kind: "document" | "video";
}

export function createBot(deps: BotDeps, botInfo?: UserFromGetMe): Bot {
  const bot = new Bot(deps.token, botInfo ? { botInfo } : undefined);
  const repo = deps.repo;
  const iso = () => deps.now().toISOString();

  const isAdmin = (id: number | undefined) => id !== undefined && String(id) === deps.adminId.trim();

  const deny = (ctx: Context) => ctx.reply("Эта команда только для автора.");

  bot.use(async (ctx, next) => {
    if (ctx.chat && ctx.chat.type !== "private") return;
    if (ctx.from && !ctx.preCheckoutQuery) {
      await repo.saveUser({
        id: ctx.from.id,
        username: ctx.from.username ?? null,
        firstName: ctx.from.first_name,
        now: iso(),
      });
    }
    await next();
  });

  bot.catch((err) => {
    log("error", "handler failed", { error: safeError(err.error) });
  });

  bot.on("pre_checkout_query", async (ctx) => {
    const query = ctx.preCheckoutQuery;
    try {
      const parsed = parseInvoicePayload(query.invoice_payload);
      const product = parsed ? getProduct(parsed.productId) : undefined;
      const alreadyOwned =
        product && !product.hidden ? await repo.hasActivePurchase(query.from.id, product.id) : false;
      const decision = checkInvoice({
        payload: query.invoice_payload,
        currency: query.currency,
        totalAmount: query.total_amount,
        fromId: query.from.id,
        adminId: deps.adminId,
        testMode: deps.testMode,
        product,
        alreadyOwned,
      });
      if (decision.ok) await ctx.answerPreCheckoutQuery(true);
      else await ctx.answerPreCheckoutQuery(false, decision.error);
    } catch (error) {
      log("error", "pre_checkout failed", { error: safeError(error) });
      await ctx.answerPreCheckoutQuery(false, "Не получилось проверить оплату. Попробуй ещё раз.");
    }
  });

  bot.on("message:successful_payment", async (ctx) => {
    const payment = ctx.message.successful_payment;
    const fromId = ctx.from?.id;
    if (!payment || fromId === undefined) return;
    const result = await applySuccessfulPayment(repo, {
      chargeId: payment.telegram_payment_charge_id,
      fromId,
      currency: payment.currency,
      totalAmount: payment.total_amount,
      payload: payment.invoice_payload,
      adminId: deps.adminId,
      testMode: deps.testMode,
      now: iso(),
    });
    if (result.type === "duplicate" && result.delivered) return;
    if (result.type === "rejected" || result.type === "already_owned") {
      await refundUnexpected(ctx, fromId, payment.telegram_payment_charge_id, result);
      return;
    }
    const product = getProduct(result.productId ?? "");
    if (!product) {
      await refundCharge(ctx, fromId, payment.telegram_payment_charge_id);
      await ctx.reply("Оплату не смог подтвердить и вернул звёзды. Если звёзды не вернулись — /paysupport.");
      return;
    }
    await ctx.reply(product.screens.thanks, {
      reply_markup: new InlineKeyboard().text("📚 Мой курс", `p:${product.id}:files`),
    });
    const count = await sendDocuments(ctx, product);
    if (count === 0) {
      await ctx.reply("Файлы ещё не загружены. Напиши /paysupport — передам автору.");
    }
    await repo.markDelivered(payment.telegram_payment_charge_id);
    if (result.type === "granted") {
      await notify(
        ctx,
        [
          "Новая покупка",
          `Продукт: ${product.title}`,
          `Покупатель: ${fromId} ${ctx.from?.username ? `@${ctx.from.username}` : "без username"}`,
          `Сумма: ${result.amount} ⭐`,
          `charge: ${payment.telegram_payment_charge_id}`,
          count === 0 ? "Файлы продукта ещё не загружены." : null,
        ]
          .filter((line): line is string => line !== null)
          .join("\n"),
      );
    }
  });

  bot.command("start", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const parsed = parseStartPayload(typeof ctx.match === "string" ? ctx.match : "", productIds());
    if (parsed.source) await repo.setSourceIfEmpty(from.id, parsed.source);
    await showOpen(ctx, parsed.productId);
  });

  bot.command("mycourse", async (ctx) => {
    if (!ctx.from) return;
    await showPurchases(ctx, ctx.from.id);
  });

  bot.command("paysupport", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const text = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (text) {
      await forwardSupport(ctx, text);
      return;
    }
    await repo.setSession(from.id, "support", null, iso());
    await ctx.reply(PAYSUPPORT_TEXT);
  });

  bot.command("terms", async (ctx) => {
    await ctx.reply(TERMS_TEXT);
  });

  bot.command("stats", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    await ctx.reply(formatStats(await repo.stats()));
  });

  bot.command("refund", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    const parts = (typeof ctx.match === "string" ? ctx.match : "").trim().split(/\s+/).filter(Boolean);
    const userId = Number(parts[0]);
    const productId = parts[1];
    if (!Number.isInteger(userId) || userId <= 0) {
      await ctx.reply("Формат: /refund <user_id> [продукт]");
      return;
    }
    const rows = await repo.listRefundable(userId, productId);
    if (rows.length === 0) {
      await ctx.reply("Активной покупки нет.");
      return;
    }
    if (rows.length > 1 && !productId) {
      await ctx.reply(`Несколько покупок. Укажи продукт: ${rows.map((row) => row.product).join(", ")}`);
      return;
    }
    const row = rows[0];
    if (!row) return;
    try {
      await ctx.api.refundStarPayment(row.userId, row.chargeId);
    } catch (error) {
      if (!alreadyRefunded(error)) {
        log("error", "refund failed", { error: safeError(error) });
        await ctx.reply("Telegram не вернул звёзды. Попробуй ещё раз позже.");
        return;
      }
    }
    await repo.markRefunded(row.chargeId);
    await ctx.reply(`Вернул ${row.amount} ⭐ пользователю ${row.userId} за ${row.product}.`);
    try {
      await ctx.api.sendMessage(
        row.userId,
        "По этой покупке оформили возврат звёзд. Если это ошибка — напиши /paysupport.",
      );
    } catch (error) {
      log("error", "refund notice failed", { error: safeError(error) });
    }
  });

  bot.command("broadcast", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    const from = ctx.from;
    if (!from) return;
    const inline = typeof ctx.match === "string" ? ctx.match.trim() : "";
    if (inline) {
      await stageBroadcast(ctx, inline);
      return;
    }
    await repo.setSession(from.id, "broadcast", null, iso());
    await ctx.reply("Пришли текст рассылки одним сообщением. Сам ничего не отправлю, пока не подтвердишь.");
  });

  bot.command("setfiles", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    const from = ctx.from;
    if (!from) return;
    const id = (typeof ctx.match === "string" ? ctx.match : "").trim().toLowerCase();
    const product = getProduct(id);
    if (!product) {
      await ctx.reply(`Нет продукта «${id}». Сейчас есть: ${productIds().join(", ")}.`);
      return;
    }
    await repo.setSession(from.id, `setfiles:${product.id}`, "[]", iso());
    await ctx.reply(
      `Загрузи файлы «${product.title}» по одному сообщению.\nПорядок PDF: курс, промты, чек-листы, архив.\nВидео можно прислать отдельно — оно откроется на экране курса.\nКогда закончишь, отправь /done. Отмена — /cancel.`,
    );
  });

  bot.command("setimage", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    const from = ctx.from;
    if (!from) return;
    const slot = (typeof ctx.match === "string" ? ctx.match : "").trim().toLowerCase();
    const allowed = new Set([MAIN_IMAGE_SLOT, ...listAllProducts().map((product) => product.coverSlot)]);
    if (!allowed.has(slot)) {
      await ctx.reply(`Пришли фото после команды.\nСлоты: ${[...allowed].join(", ")}.\nПример: /setimage main`);
      return;
    }
    await repo.setSession(from.id, `setimage:${slot}`, null, iso());
    await ctx.reply(`Пришли фото для «${slot}». Отмена — /cancel.`);
  });

  bot.command("reply", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    const match = /^(\d+)\s+([\s\S]+)$/.exec(typeof ctx.match === "string" ? ctx.match.trim() : "");
    if (!match) {
      await ctx.reply("Формат: /reply <id> текст");
      return;
    }
    const target = Number(match[1]);
    const text = match[2] ?? "";
    try {
      await ctx.api.sendMessage(target, text);
    } catch (error) {
      log("error", "reply failed", { error: safeError(error) });
      await ctx.reply("Не смог отправить. Проверь id: человек должен был нажать /start.");
      return;
    }
    await ctx.reply("Отправил.");
  });

  bot.command("done", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    const from = ctx.from;
    if (!from) return;
    const session = await repo.getSession(from.id);
    if (!session?.state.startsWith("setfiles:")) {
      await ctx.reply("Сейчас нечего сохранять.");
      return;
    }
    const product = getProduct(session.state.slice("setfiles:".length));
    if (!product) {
      await repo.clearSession(from.id);
      await ctx.reply("Продукт не найден, загрузку отменил.");
      return;
    }
    const staged = parseStaged(session.data);
    let docIndex = 0;
    const files: StoredFile[] = staged.map((file) => {
      let caption = file.caption;
      if (file.kind === "document") {
        if (!caption) caption = product.fileCaptions[docIndex] ?? null;
        docIndex += 1;
      } else if (!caption) {
        caption = "Промо";
      }
      return { fileId: file.fileId, fileName: file.fileName, caption, kind: file.kind };
    });
    await repo.replaceProductFiles(product.id, files);
    await repo.clearSession(from.id);
    const videos = files.filter((file) => file.kind === "video").length;
    await ctx.reply(
      `Сохранил файлов: ${files.length} (документов ${files.length - videos}, видео ${videos}).`,
    );
  });

  bot.command("cancel", async (ctx) => {
    if (!isAdmin(ctx.from?.id)) return deny(ctx);
    if (!ctx.from) return;
    await repo.clearSession(ctx.from.id);
    await ctx.reply("Отменил. Старые файлы и картинки на месте.");
  });

  bot.on("callback_query:data", async (ctx) => {
    const data = ctx.callbackQuery.data;
    try {
      await ctx.answerCallbackQuery();
    } catch (error) {
      log("error", "callback answer failed", { error: safeError(error) });
    }
    const from = ctx.from;
    if (data === "go:main") {
      await showOpen(ctx, null);
      return;
    }
    if (data === "go:mine") {
      await showPurchases(ctx, from.id);
      return;
    }
    if (data === "bc:ok" || data === "bc:no") {
      await confirmBroadcast(ctx, data === "bc:ok");
      return;
    }
    const match = /^p:([a-z0-9]+):(home|in|get|mon|faq|buy|pay|files)$/.exec(data);
    if (!match) return;
    const product = getProduct(match[1] ?? "");
    const action = match[2];
    if (!product) {
      await ctx.reply("Этого продукта нет.");
      return;
    }
    if (action !== "files" && product.hidden) {
      await ctx.reply("Этот продукт ещё не открыт.");
      return;
    }
    if (action === "files") {
      await resendFiles(ctx, product, from.id);
      return;
    }
    await showOpen(ctx, product.id);
  });

  bot.on("message:photo", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const session = await repo.getSession(from.id);
    if (session?.state.startsWith("setimage:") && isAdmin(from.id)) {
      const photos = ctx.message.photo ?? [];
      const best = photos[photos.length - 1];
      if (!best) return;
      const slot = session.state.slice("setimage:".length);
      await repo.setMedia(slot, best.file_id, iso());
      await repo.clearSession(from.id);
      await ctx.reply(`Готово, картинка «${slot}» заменена.`);
      return;
    }
    if (session?.state.startsWith("setfiles:") && isAdmin(from.id)) {
      await ctx.reply("Пришли PDF как файл (скрепка → Файл), не как сжатое фото.");
      return;
    }
    await ctx.reply("Открой приложение кнопкой «Открыть» или командой /start.");
  });

  bot.on("message:video", async (ctx) => {
    const video = ctx.message.video;
    if (!video) return;
    await takeFile(ctx, {
      fileId: video.file_id,
      fileName: video.file_name ?? "video.mp4",
      caption: ctx.message.caption ?? null,
      kind: "video",
    });
  });

  bot.on("message:document", async (ctx) => {
    const document = ctx.message.document;
    if (!document) return;
    await takeFile(ctx, {
      fileId: document.file_id,
      fileName: document.file_name ?? null,
      caption: ctx.message.caption ?? null,
      kind: "document",
    });
  });

  bot.on("message:text", async (ctx) => {
    const from = ctx.from;
    if (!from) return;
    const text = ctx.message.text;
    if (text.startsWith("/")) {
      await ctx.reply("Не знаю такую команду. Открой приложение кнопкой «Открыть» или нажми /start.");
      return;
    }
    const session = await repo.getSession(from.id);
    if (session?.state === "support") {
      await forwardSupport(ctx, text);
      return;
    }
    if (session?.state === "broadcast" && isAdmin(from.id)) {
      await stageBroadcast(ctx, text);
      return;
    }
    if (session?.state.startsWith("setfiles:") && isAdmin(from.id)) {
      await ctx.reply("Жду файл. Когда закончишь — /done.");
      return;
    }
    if (session?.state.startsWith("setimage:") && isAdmin(from.id)) {
      await ctx.reply("Жду фото. Отмена — /cancel.");
      return;
    }
    await ctx.reply("Открой приложение кнопкой «Открыть» или командой /start.");
  });

  bot.on("message", async (ctx) => {
    await ctx.reply("Открой приложение кнопкой «Открыть» или командой /start.");
  });

  return bot;

  function openKeyboard(productId: string | null): InlineKeyboard {
    const url = productId ? `${miniAppUrl(deps.appUrl)}#${productId}` : miniAppUrl(deps.appUrl);
    return new InlineKeyboard().webApp("Открыть", url);
  }

  async function showOpen(ctx: Context, productId: string | null): Promise<void> {
    const product = productId ? getProduct(productId) : undefined;
    await ctx.reply(START_TEXT, {
      reply_markup: openKeyboard(product && !product.hidden ? product.id : null),
    });
  }

  async function resendFiles(ctx: Context, product: Product, userId: number): Promise<void> {
    if (!(await repo.hasActivePurchase(userId, product.id))) {
      await ctx.reply("Сначала купи этот продукт.", { reply_markup: openKeyboard(product.id) });
      return;
    }
    await ctx.reply(`Файлы «${product.title}»:`);
    const count = await sendDocuments(ctx, product);
    if (count === 0) await ctx.reply("Файлы ещё не загружены. Напиши /paysupport — передам автору.");
  }

  async function showPurchases(ctx: Context, userId: number): Promise<void> {
    const rows = await repo.listActivePurchases(userId);
    if (rows.length === 0) {
      await ctx.reply("Пока покупок нет.", { reply_markup: openKeyboard(null) });
      return;
    }
    const keyboard = new InlineKeyboard();
    for (const row of rows) {
      const product = getProduct(row.product);
      keyboard.text(product?.button ?? row.product, `p:${row.product}:files`).row();
    }
    await ctx.reply("Твои покупки:", { reply_markup: keyboard });
  }

  async function sendDocuments(ctx: Context, product: Product): Promise<number> {
    const docs = (await repo.listProductFiles(product.id)).filter((file) => file.kind === "document");
    for (const doc of docs) {
      await ctx.replyWithDocument(doc.fileId, doc.caption ? { caption: doc.caption } : {});
    }
    return docs.length;
  }

  async function takeFile(ctx: Context, file: StagedFile): Promise<void> {
    const from = ctx.from;
    if (!from || !isAdmin(from.id)) {
      await ctx.reply("Открой приложение кнопкой «Открыть» или командой /start.");
      return;
    }
    const session = await repo.getSession(from.id);
    if (!session?.state.startsWith("setfiles:")) {
      await ctx.reply("Чтобы загрузить файлы курса, сначала отправь /setfiles pixelverse.");
      return;
    }
    const staged = parseStaged(session.data);
    staged.push(file);
    await repo.setSession(from.id, session.state, JSON.stringify(staged), iso());
    await ctx.reply(`Принял ${staged.length}: ${file.fileName ?? file.kind}. Дальше или /done.`);
  }

  async function forwardSupport(ctx: Context, text: string): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const username = from.username ? `@${from.username}` : "без username";
    await notify(ctx, `Вопрос по оплате\nОт: ${from.first_name} ${username}\nid: ${from.id}\n\n${text}`);
    await repo.clearSession(from.id);
    await ctx.reply("Передал. Ответим в течение 24 часов.");
  }

  async function stageBroadcast(ctx: Context, text: string): Promise<void> {
    const from = ctx.from;
    if (!from) return;
    const clean = text.trim();
    if (!clean) {
      await ctx.reply("Пустой текст. Пришли сообщение ещё раз.");
      return;
    }
    if (clean.length > 4096) {
      await ctx.reply("Слишком длинно для Telegram (максимум 4096 символов). Сократи.");
      return;
    }
    await repo.setSession(from.id, "broadcast_confirm", clean, iso());
    const stats = await repo.stats();
    const header = `Так уйдёт всем, кто нажимал /start.\nПолучателей: ${stats.starts}\n\n`;
    const room = Math.max(0, 4000 - header.length);
    const preview = clean.length > room ? `${clean.slice(0, room)}…` : clean;
    await ctx.reply(`${header}${preview}`, {
      reply_markup: new InlineKeyboard().text("Отправить", "bc:ok").text("Отмена", "bc:no"),
    });
  }

  async function confirmBroadcast(ctx: Context, send: boolean): Promise<void> {
    const from = ctx.from;
    if (!from || !isAdmin(from.id)) {
      await ctx.reply("Эта кнопка только для автора.");
      return;
    }
    const session = await repo.getSession(from.id);
    if (!send) {
      await repo.clearSession(from.id);
      await ctx.reply("Рассылку отменил.");
      return;
    }
    if (session?.state !== "broadcast_confirm" || !session.data) {
      await ctx.reply("Нет текста для рассылки. Начни с /broadcast.");
      return;
    }
    const stats = await repo.stats();
    if (stats.starts === 0) {
      await repo.clearSession(from.id);
      await ctx.reply("Пока некому отправлять: никто не нажимал /start.");
      return;
    }
    const queued = await repo.enqueueBroadcast(session.data, from.id, iso());
    await repo.clearSession(from.id);
    await ctx.reply(`Поставил в очередь: ${queued.recipients}. Уйдёт порциями, примерно раз в минуту.`);
  }

  async function notify(ctx: Context, text: string): Promise<void> {
    const adminId = Number(deps.adminId.trim());
    if (!Number.isInteger(adminId)) return;
    try {
      await ctx.api.sendMessage(adminId, text);
    } catch (error) {
      log("error", "admin notify failed", { error: safeError(error) });
    }
  }

  async function refundCharge(ctx: Context, userId: number, chargeId: string): Promise<void> {
    try {
      await ctx.api.refundStarPayment(userId, chargeId);
    } catch (error) {
      if (!alreadyRefunded(error)) {
        log("error", "refund unexpected payment failed", { error: safeError(error) });
        await notify(ctx, `Не смог вернуть спорную оплату.\nuser ${userId}\ncharge ${chargeId}`);
      }
    }
  }

  async function refundUnexpected(
    ctx: Context,
    userId: number,
    chargeId: string,
    result: Extract<SuccessResult, { type: "rejected" | "already_owned" }>,
  ): Promise<void> {
    await refundCharge(ctx, userId, chargeId);
    if (result.type === "already_owned") {
      await ctx.reply("Этот продукт уже куплен. Повторную оплату вернул звёздами.");
      return;
    }
    await ctx.reply("Оплату не смог подтвердить и вернул звёзды. Если звёзды не вернулись — /paysupport.");
    await notify(ctx, `Платёж отклонён и возвращён.\nuser ${userId}\n${result.error}`);
  }
}

function alreadyRefunded(error: unknown): boolean {
  const text = error instanceof GrammyError ? error.description : error instanceof Error ? error.message : "";
  return /already refunded|CHARGE_ALREADY_REFUNDED/i.test(text);
}

function parseStaged(data: string | null): StagedFile[] {
  if (!data) return [];
  try {
    const parsed: unknown = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    const files: StagedFile[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.fileId !== "string") continue;
      if (row.kind !== "document" && row.kind !== "video") continue;
      files.push({
        fileId: row.fileId,
        fileName: typeof row.fileName === "string" ? row.fileName : null,
        caption: typeof row.caption === "string" ? row.caption : null,
        kind: row.kind,
      });
    }
    return files;
  } catch {
    return [];
  }
}
