import type { ChargeRecord, PurchaseRow, Repo, SessionRow, Stats } from "./repo";

function constraintKind(error: unknown): "charge" | "active" | null {
  const text = error instanceof Error ? error.message : String(error);
  if (!text.includes("UNIQUE")) return null;
  if (text.includes("charge_id")) return "charge";
  return "active";
}

export function createD1Repo(db: D1Database): Repo {
  return {
    async saveUser(input) {
      await db
        .prepare(
          `INSERT INTO users (user_id, username, first_name, first_seen, last_seen, source)
           VALUES (?, ?, ?, ?, ?, NULL)
           ON CONFLICT(user_id) DO UPDATE SET
             username = excluded.username,
             first_name = excluded.first_name,
             last_seen = excluded.last_seen`,
        )
        .bind(input.id, input.username, input.firstName, input.now, input.now)
        .run();
    },
    async setSourceIfEmpty(userId, source) {
      await db
        .prepare(`UPDATE users SET source = ? WHERE user_id = ? AND source IS NULL`)
        .bind(source, userId)
        .run();
    },
    async hasActivePurchase(userId, productId) {
      const row = await db
        .prepare(
          `SELECT 1 AS n FROM purchases WHERE user_id = ? AND product = ? AND refunded = 0 LIMIT 1`,
        )
        .bind(userId, productId)
        .first<{ n: number }>();
      return row !== null;
    },
    async listActivePurchases(userId) {
      const rows = await db
        .prepare(
          `SELECT product FROM purchases WHERE user_id = ? AND refunded = 0 ORDER BY purchased_at ASC`,
        )
        .bind(userId)
        .all<{ product: string }>();
      return rows.results;
    },
    async getCharge(chargeId) {
      const row = await db
        .prepare(
          `SELECT charge_id, user_id, product, amount, payload, outcome FROM charge_log WHERE charge_id = ?`,
        )
        .bind(chargeId)
        .first<{
          charge_id: string;
          user_id: number;
          product: string | null;
          amount: number;
          payload: string;
          outcome: ChargeRecord["outcome"];
        }>();
      if (!row) return null;
      return {
        chargeId: row.charge_id,
        userId: row.user_id,
        product: row.product,
        amount: row.amount,
        payload: row.payload,
        outcome: row.outcome,
      };
    },
    async beginCharge(input) {
      try {
        await db
          .prepare(
            `INSERT INTO charge_log (charge_id, user_id, product, amount, payload, outcome, created_at)
             VALUES (?, ?, ?, ?, ?, 'processing', ?)`,
          )
          .bind(input.chargeId, input.userId, input.product, input.amount, input.payload, input.now)
          .run();
        return "created";
      } catch (error) {
        if (constraintKind(error)) return "exists";
        throw error;
      }
    },
    async finishCharge(chargeId, outcome) {
      await db.prepare(`UPDATE charge_log SET outcome = ? WHERE charge_id = ?`).bind(outcome, chargeId).run();
    },
    async insertPurchase(input) {
      const sameCharge = await db
        .prepare(`SELECT 1 AS n FROM purchases WHERE charge_id = ?`)
        .bind(input.chargeId)
        .first<{ n: number }>();
      if (sameCharge) return "duplicate_charge";
      if (await this.hasActivePurchase(input.userId, input.product)) return "already_owned";
      try {
        await db
          .prepare(
            `INSERT INTO purchases (user_id, product, charge_id, amount, purchased_at, payload, refunded, delivered)
             VALUES (?, ?, ?, ?, ?, ?, 0, 0)`,
          )
          .bind(input.userId, input.product, input.chargeId, input.amount, input.now, input.payload)
          .run();
        return "created";
      } catch (error) {
        const raced = await db
          .prepare(`SELECT 1 AS n FROM purchases WHERE charge_id = ?`)
          .bind(input.chargeId)
          .first<{ n: number }>();
        if (raced) return "duplicate_charge";
        const kind = constraintKind(error);
        if (kind) return "already_owned";
        throw error;
      }
    },
    async isDelivered(chargeId) {
      const row = await db
        .prepare(`SELECT delivered AS n FROM purchases WHERE charge_id = ?`)
        .bind(chargeId)
        .first<{ n: number }>();
      return row?.n === 1;
    },
    async markDelivered(chargeId) {
      await db.prepare(`UPDATE purchases SET delivered = 1 WHERE charge_id = ?`).bind(chargeId).run();
    },
    async listRefundable(userId, productId) {
      const product = productId ?? "";
      const rows = await db
        .prepare(
          `SELECT user_id, product, charge_id, amount, refunded, delivered
           FROM purchases
           WHERE user_id = ? AND refunded = 0 AND (? = '' OR product = ?)
           ORDER BY purchased_at DESC`,
        )
        .bind(userId, product, product)
        .all<{
          user_id: number;
          product: string;
          charge_id: string;
          amount: number;
          refunded: number;
          delivered: number;
        }>();
      return rows.results.map(mapPurchase);
    },
    async getRefundableByCharge(chargeId) {
      const row = await db
        .prepare(
          `SELECT user_id, product, charge_id, amount, refunded, delivered
           FROM purchases WHERE charge_id = ? AND refunded = 0`,
        )
        .bind(chargeId)
        .first<{
          user_id: number;
          product: string;
          charge_id: string;
          amount: number;
          refunded: number;
          delivered: number;
        }>();
      return row ? mapPurchase(row) : null;
    },
    async markRefunded(chargeId) {
      const result = await db
        .prepare(`UPDATE purchases SET refunded = 1 WHERE charge_id = ? AND refunded = 0`)
        .bind(chargeId)
        .run();
      return (result.meta.changes ?? 0) > 0;
    },
    async listProductFiles(productId) {
      const rows = await db
        .prepare(
          `SELECT file_id, file_name, caption, kind
           FROM product_files WHERE product = ? ORDER BY sort_order ASC, id ASC`,
        )
        .bind(productId)
        .all<{ file_id: string; file_name: string | null; caption: string | null; kind: string }>();
      return rows.results.map((row) => ({
        fileId: row.file_id,
        fileName: row.file_name,
        caption: row.caption,
        kind: row.kind === "video" ? "video" : "document",
      }));
    },
    async replaceProductFiles(productId, files) {
      const statements = [
        db.prepare(`DELETE FROM product_files WHERE product = ?`).bind(productId),
        ...files.map((file, index) =>
          db
            .prepare(
              `INSERT INTO product_files (product, sort_order, file_id, file_name, caption, kind)
               VALUES (?, ?, ?, ?, ?, ?)`,
            )
            .bind(productId, index, file.fileId, file.fileName, file.caption, file.kind),
        ),
      ];
      await db.batch(statements);
    },
    async getMedia(slot) {
      const row = await db
        .prepare(`SELECT file_id FROM media_files WHERE slot = ?`)
        .bind(slot)
        .first<{ file_id: string }>();
      return row?.file_id ?? null;
    },
    async setMedia(slot, fileId, now) {
      await db
        .prepare(
          `INSERT INTO media_files (slot, file_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(slot) DO UPDATE SET file_id = excluded.file_id, updated_at = excluded.updated_at`,
        )
        .bind(slot, fileId, now)
        .run();
    },
    async getSession(userId) {
      const row = await db
        .prepare(`SELECT state, data FROM sessions WHERE user_id = ?`)
        .bind(userId)
        .first<SessionRow>();
      return row ?? null;
    },
    async setSession(userId, state, data, now) {
      await db
        .prepare(
          `INSERT INTO sessions (user_id, state, data, updated_at) VALUES (?, ?, ?, ?)
           ON CONFLICT(user_id) DO UPDATE SET
             state = excluded.state,
             data = excluded.data,
             updated_at = excluded.updated_at`,
        )
        .bind(userId, state, data, now)
        .run();
    },
    async clearSession(userId) {
      await db.prepare(`DELETE FROM sessions WHERE user_id = ?`).bind(userId).run();
    },
    async stats() {
      const starts = await db.prepare(`SELECT COUNT(*) AS n FROM users`).first<{ n: number }>();
      const purchases = await db
        .prepare(`SELECT COUNT(*) AS n FROM purchases WHERE refunded = 0`)
        .first<{ n: number }>();
      const sources = await db
        .prepare(
          `SELECT COALESCE(source, '') AS source, COUNT(*) AS n
           FROM users GROUP BY source ORDER BY n DESC, source ASC`,
        )
        .all<{ source: string; n: number }>();
      const products = await db
        .prepare(
          `SELECT product, COUNT(*) AS n FROM purchases WHERE refunded = 0
           GROUP BY product ORDER BY n DESC, product ASC`,
        )
        .all<{ product: string; n: number }>();
      const stats: Stats = {
        starts: starts?.n ?? 0,
        purchases: purchases?.n ?? 0,
        bySource: sources.results.map((row) => ({ source: row.source, count: row.n })),
        byProduct: products.results.map((row) => ({ product: row.product, count: row.n })),
      };
      return stats;
    },
    async enqueueBroadcast(text, createdBy, now) {
      const created = await db
        .prepare(
          `INSERT INTO broadcasts (text, created_by, created_at, status) VALUES (?, ?, ?, 'queued')`,
        )
        .bind(text, createdBy, now)
        .run();
      const inserted = await db
        .prepare(
          `INSERT INTO broadcast_recipients (broadcast_id, user_id, status)
           SELECT ?, user_id, 'pending' FROM users`,
        )
        .bind(created.meta.last_row_id)
        .run();
      return { recipients: inserted.meta.changes ?? 0 };
    },
    async reclaimBroadcastLeases(staleBeforeIso) {
      await db
        .prepare(
          `UPDATE broadcast_recipients
           SET status = 'failed', last_error = 'too many attempts'
           WHERE status = 'leased' AND attempts >= 5 AND leased_at < ?`,
        )
        .bind(staleBeforeIso)
        .run();
      await db
        .prepare(
          `UPDATE broadcast_recipients
           SET status = 'pending'
           WHERE status = 'leased' AND attempts < 5 AND leased_at < ?`,
        )
        .bind(staleBeforeIso)
        .run();
    },
    async leaseBroadcastBatch(limit, now) {
      const selected = await db
        .prepare(
          `SELECT r.id, r.user_id, b.text
           FROM broadcast_recipients r
           JOIN broadcasts b ON b.id = r.broadcast_id
           WHERE r.status = 'pending'
           ORDER BY r.id
           LIMIT ?`,
        )
        .bind(limit)
        .all<{ id: number; user_id: number; text: string }>();
      const jobs = [];
      for (const row of selected.results) {
        const updated = await db
          .prepare(
            `UPDATE broadcast_recipients
             SET status = 'leased', attempts = attempts + 1, leased_at = ?
             WHERE id = ? AND status = 'pending'`,
          )
          .bind(now, row.id)
          .run();
        if ((updated.meta.changes ?? 0) === 1) {
          jobs.push({ id: row.id, userId: row.user_id, text: row.text });
        }
      }
      return jobs;
    },
    async finishBroadcastJob(id, status, error) {
      await db
        .prepare(`UPDATE broadcast_recipients SET status = ?, last_error = ? WHERE id = ?`)
        .bind(status, error, id)
        .run();
    },
  };
}

function mapPurchase(row: {
  user_id: number;
  product: string;
  charge_id: string;
  amount: number;
  refunded: number;
  delivered: number;
}): PurchaseRow {
  return {
    userId: row.user_id,
    product: row.product,
    chargeId: row.charge_id,
    amount: row.amount,
    refunded: row.refunded === 1,
    delivered: row.delivered === 1,
  };
}
