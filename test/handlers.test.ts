import { describe, expect, it } from "vitest";
import { buildInvoicePayload } from "../src/payload";
import { FILE_CAPTIONS, START_TEXT } from "../src/texts";
import {
  callbackUpdate,
  commandUpdate,
  documentUpdate,
  paymentUpdate,
  preCheckoutUpdate,
  withBot,
} from "./harness";

describe("handlers", () => {
  it("opens the mini app and remembers the source", async () => {
    await withBot({}, async ({ handle, calls, repo }) => {
      await handle(commandUpdate("/start tiktok"));
      const message = calls.find((call) => call.method === "sendMessage");
      expect(message?.body.text).toBe(START_TEXT);
      expect(String(message?.body.text)).not.toContain("Добро пожаловать");
      const markup = JSON.stringify(message?.body.reply_markup);
      expect(markup).toContain("Открыть");
      expect(markup).toContain("https://markus-brown.kiritosinse.workers.dev/app");
      expect(markup).not.toContain("PIXEL VERSE");
      expect(calls.some((call) => call.method === "sendPhoto")).toBe(false);
      expect(repo.users.get(7)?.source).toBe("tiktok");
    });
  });

  it("keeps a course deep link on the open button and remembers the source", async () => {
    await withBot({}, async ({ handle, calls, repo }) => {
      await handle(commandUpdate("/start pixelverse_youtube"));
      const message = calls.find((call) => call.method === "sendMessage");
      expect(message?.body.text).toBe(START_TEXT);
      expect(JSON.stringify(message?.body.reply_markup)).toContain("/app#pixelverse");
      expect(repo.users.get(7)?.source).toBe("youtube");
    });
  });

  it("sends old catalog buttons to the mini app", async () => {
    await withBot({}, async ({ handle, calls }) => {
      await handle(callbackUpdate("p:pixelverse:pay"));
      const message = calls.find((call) => call.method === "sendMessage");
      expect(message?.body.text).toBe(START_TEXT);
      expect(JSON.stringify(message?.body.reply_markup)).toContain("web_app");
      expect(calls.some((call) => call.method === "sendInvoice")).toBe(false);
    });
  });

  it("answers pre_checkout with the same price rule", async () => {
    await withBot({ testMode: "1" }, async ({ handle, calls }) => {
      const buyer = buildInvoicePayload("pixelverse", 7, 1);
      const owner = buildInvoicePayload("pixelverse", 42, 1);
      await handle(preCheckoutUpdate(buyer, 990, 7));
      await handle(preCheckoutUpdate(buyer, 1, 7));
      await handle(preCheckoutUpdate(owner, 1, 42));
      await handle(preCheckoutUpdate(owner, 990, 42));
      const answers = calls.filter((call) => call.method === "answerPreCheckoutQuery");
      expect(answers.map((call) => call.body.ok)).toEqual([true, false, true, false]);
      expect(answers[1]?.body.error_message).toContain("Сумма не совпадает");
    });
  });

  it("delivers the course once for the same payment", async () => {
    await withBot({}, async ({ handle, calls, repo }) => {
      const payload = buildInvoicePayload("pixelverse", 7, 1);
      await handle(paymentUpdate(payload, 990, "chg-1"));
      const delivered = calls.filter((call) => call.method === "sendMessage" || call.method === "sendDocument");
      expect(delivered.some((call) => String(call.body.text ?? "").includes("Добро пожаловать в студию"))).toBe(
        true,
      );
      expect(delivered.some((call) => String(call.body.text ?? "").includes("Новая покупка"))).toBe(true);
      expect(repo.purchases).toHaveLength(1);
      expect(repo.purchases[0]?.delivered).toBe(true);
      await handle(paymentUpdate(payload, 990, "chg-1"));
      const again = calls.filter((call) => call.method === "sendMessage" || call.method === "sendDocument");
      expect(again).toHaveLength(delivered.length);
      expect(repo.purchases).toHaveLength(1);
    });
  });

  it("refunds an active purchase and hides it from my course", async () => {
    await withBot({}, async ({ handle, calls, repo }) => {
      const payload = buildInvoicePayload("pixelverse", 7, 1);
      await handle(paymentUpdate(payload, 990, "chg-1"));
      await handle(commandUpdate("/refund 7 pixelverse", 42));
      expect(calls.some((call) => call.method === "refundStarPayment")).toBe(true);
      expect(repo.purchases[0]?.refunded).toBe(true);
      await handle(commandUpdate("/mycourse", 7));
      const last = calls.filter((call) => call.method === "sendMessage").at(-1);
      expect(last?.body.text).toContain("Пока покупок нет");
    });
  });

  it("stores course files from the admin and keeps the default captions", async () => {
    await withBot({}, async ({ handle, calls, repo }) => {
      await handle(commandUpdate("/setfiles pixelverse", 42));
      await handle(documentUpdate("doc-course", 42));
      await handle(commandUpdate("/done", 42));
      const files = await repo.listProductFiles("pixelverse");
      expect(files).toEqual([
        {
          fileId: "doc-course",
          fileName: "course.pdf",
          caption: FILE_CAPTIONS[0],
          kind: "document",
        },
      ]);
      expect(calls.some((call) => String(call.body.text ?? "").includes("Сохранил файлов: 1"))).toBe(true);
    });
  });

  it("refuses admin commands from other people", async () => {
    await withBot({}, async ({ handle, calls }) => {
      await handle(commandUpdate("/stats", 7));
      expect(calls.at(-1)?.body.text).toContain("только для автора");
    });
  });

});
