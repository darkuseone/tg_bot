import type {
  BroadcastJob,
  ChargeRecord,
  PurchaseRow,
  Repo,
  SessionRow,
  Stats,
  StoredFile,
} from "../src/repo";

interface UserRow {
  id: number;
  username: string | null;
  firstName: string | null;
  firstSeen: string;
  lastSeen: string;
  source: string | null;
}

interface Purchase extends PurchaseRow {
  payload: string;
  purchasedAt: string;
}

interface Recipient {
  id: number;
  broadcastId: number;
  userId: number;
  text: string;
  status: "pending" | "leased" | "sent" | "failed";
  attempts: number;
  leasedAt: string | null;
  lastError: string | null;
}

export class MemoryRepo implements Repo {
  users = new Map<number, UserRow>();
  purchases: Purchase[] = [];
  charges = new Map<string, ChargeRecord>();
  files = new Map<string, StoredFile[]>();
  media = new Map<string, string>();
  sessions = new Map<number, SessionRow>();
  recipients: Recipient[] = [];
  private recipientSeq = 1;

  async saveUser(input: {
    id: number;
    username: string | null;
    firstName: string | null;
    now: string;
  }): Promise<void> {
    const current = this.users.get(input.id);
    if (!current) {
      this.users.set(input.id, {
        id: input.id,
        username: input.username,
        firstName: input.firstName,
        firstSeen: input.now,
        lastSeen: input.now,
        source: null,
      });
      return;
    }
    current.username = input.username;
    current.firstName = input.firstName;
    current.lastSeen = input.now;
  }

  async setSourceIfEmpty(userId: number, source: string): Promise<void> {
    const user = this.users.get(userId);
    if (user && user.source === null) user.source = source;
  }

  async hasActivePurchase(userId: number, productId: string): Promise<boolean> {
    return this.purchases.some((row) => row.userId === userId && row.product === productId && !row.refunded);
  }

  async listActivePurchases(userId: number): Promise<{ product: string }[]> {
    return this.purchases
      .filter((row) => row.userId === userId && !row.refunded)
      .sort((a, b) => a.purchasedAt.localeCompare(b.purchasedAt))
      .map((row) => ({ product: row.product }));
  }

  async getCharge(chargeId: string): Promise<ChargeRecord | null> {
    return this.charges.get(chargeId) ?? null;
  }

  async beginCharge(input: {
    chargeId: string;
    userId: number;
    product: string | null;
    amount: number;
    payload: string;
    now: string;
  }): Promise<"created" | "exists"> {
    if (this.charges.has(input.chargeId)) return "exists";
    this.charges.set(input.chargeId, {
      chargeId: input.chargeId,
      userId: input.userId,
      product: input.product,
      amount: input.amount,
      payload: input.payload,
      outcome: "processing",
    });
    return "created";
  }

  async finishCharge(chargeId: string, outcome: ChargeRecord["outcome"]): Promise<void> {
    const row = this.charges.get(chargeId);
    if (row) row.outcome = outcome;
  }

  async insertPurchase(input: {
    userId: number;
    product: string;
    chargeId: string;
    amount: number;
    payload: string;
    now: string;
  }): Promise<"created" | "duplicate_charge" | "already_owned"> {
    if (this.purchases.some((row) => row.chargeId === input.chargeId)) return "duplicate_charge";
    if (await this.hasActivePurchase(input.userId, input.product)) return "already_owned";
    this.purchases.push({
      userId: input.userId,
      product: input.product,
      chargeId: input.chargeId,
      amount: input.amount,
      payload: input.payload,
      purchasedAt: input.now,
      refunded: false,
      delivered: false,
    });
    return "created";
  }

  async isDelivered(chargeId: string): Promise<boolean> {
    return this.purchases.find((row) => row.chargeId === chargeId)?.delivered ?? false;
  }

  async markDelivered(chargeId: string): Promise<void> {
    const row = this.purchases.find((item) => item.chargeId === chargeId);
    if (row) row.delivered = true;
  }

  async listRefundable(userId: number, productId?: string): Promise<PurchaseRow[]> {
    return this.purchases
      .filter((row) => row.userId === userId && !row.refunded && (!productId || row.product === productId))
      .sort((a, b) => b.purchasedAt.localeCompare(a.purchasedAt))
      .map((row) => ({ ...row }));
  }

  async markRefunded(chargeId: string): Promise<boolean> {
    const row = this.purchases.find((item) => item.chargeId === chargeId && !item.refunded);
    if (!row) return false;
    row.refunded = true;
    return true;
  }

  async listProductFiles(productId: string): Promise<StoredFile[]> {
    return [...(this.files.get(productId) ?? [])];
  }

  async replaceProductFiles(productId: string, files: StoredFile[]): Promise<void> {
    this.files.set(productId, files.map((file) => ({ ...file })));
  }

  async getMedia(slot: string): Promise<string | null> {
    return this.media.get(slot) ?? null;
  }

  async setMedia(slot: string, fileId: string, _now: string): Promise<void> {
    this.media.set(slot, fileId);
  }

  async getSession(userId: number): Promise<SessionRow | null> {
    return this.sessions.get(userId) ?? null;
  }

  async setSession(userId: number, state: string, data: string | null, _now: string): Promise<void> {
    this.sessions.set(userId, { state, data });
  }

  async clearSession(userId: number): Promise<void> {
    this.sessions.delete(userId);
  }

  async stats(): Promise<Stats> {
    const bySource = new Map<string, number>();
    for (const user of this.users.values()) {
      const key = user.source ?? "";
      bySource.set(key, (bySource.get(key) ?? 0) + 1);
    }
    const byProduct = new Map<string, number>();
    for (const purchase of this.purchases) {
      if (purchase.refunded) continue;
      byProduct.set(purchase.product, (byProduct.get(purchase.product) ?? 0) + 1);
    }
    return {
      starts: this.users.size,
      purchases: this.purchases.filter((row) => !row.refunded).length,
      bySource: [...bySource.entries()]
        .map(([source, count]) => ({ source, count }))
        .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source)),
      byProduct: [...byProduct.entries()]
        .map(([product, count]) => ({ product, count }))
        .sort((a, b) => b.count - a.count || a.product.localeCompare(b.product)),
    };
  }

  async enqueueBroadcast(text: string, _createdBy: number, _now: string): Promise<{ recipients: number }> {
    let recipients = 0;
    for (const user of this.users.values()) {
      this.recipients.push({
        id: this.recipientSeq++,
        broadcastId: 1,
        userId: user.id,
        text,
        status: "pending",
        attempts: 0,
        leasedAt: null,
        lastError: null,
      });
      recipients += 1;
    }
    return { recipients };
  }

  async reclaimBroadcastLeases(staleBeforeIso: string): Promise<void> {
    for (const row of this.recipients) {
      if (row.status !== "leased" || !row.leasedAt || row.leasedAt >= staleBeforeIso) continue;
      if (row.attempts >= 5) {
        row.status = "failed";
        row.lastError = "too many attempts";
      } else {
        row.status = "pending";
      }
    }
  }

  async leaseBroadcastBatch(limit: number, now: string): Promise<BroadcastJob[]> {
    const jobs: BroadcastJob[] = [];
    for (const row of this.recipients) {
      if (jobs.length >= limit) break;
      if (row.status !== "pending") continue;
      row.status = "leased";
      row.attempts += 1;
      row.leasedAt = now;
      jobs.push({ id: row.id, userId: row.userId, text: row.text });
    }
    return jobs;
  }

  async finishBroadcastJob(
    id: number,
    status: "sent" | "pending" | "failed",
    error: string | null,
  ): Promise<void> {
    const row = this.recipients.find((item) => item.id === id);
    if (!row) return;
    row.status = status;
    row.lastError = error;
  }
}
