export interface ChargeRecord {
  chargeId: string;
  userId: number;
  product: string | null;
  amount: number;
  payload: string;
  outcome: "processing" | "granted" | "rejected" | "already_owned";
}

export interface PurchaseRow {
  userId: number;
  product: string;
  chargeId: string;
  amount: number;
  refunded: boolean;
  delivered: boolean;
}

export interface StoredFile {
  fileId: string;
  fileName: string | null;
  caption: string | null;
  kind: "document" | "video";
}

export interface SessionRow {
  state: string;
  data: string | null;
}

export interface BroadcastJob {
  id: number;
  userId: number;
  text: string;
}

export interface Stats {
  starts: number;
  purchases: number;
  bySource: { source: string; count: number }[];
  byProduct: { product: string; count: number }[];
}

export interface Repo {
  saveUser(input: {
    id: number;
    username: string | null;
    firstName: string | null;
    now: string;
  }): Promise<void>;
  setSourceIfEmpty(userId: number, source: string): Promise<void>;
  hasActivePurchase(userId: number, productId: string): Promise<boolean>;
  listActivePurchases(userId: number): Promise<{ product: string }[]>;
  getCharge(chargeId: string): Promise<ChargeRecord | null>;
  beginCharge(input: {
    chargeId: string;
    userId: number;
    product: string | null;
    amount: number;
    payload: string;
    now: string;
  }): Promise<"created" | "exists">;
  finishCharge(chargeId: string, outcome: ChargeRecord["outcome"]): Promise<void>;
  insertPurchase(input: {
    userId: number;
    product: string;
    chargeId: string;
    amount: number;
    payload: string;
    now: string;
  }): Promise<"created" | "duplicate_charge" | "already_owned">;
  isDelivered(chargeId: string): Promise<boolean>;
  markDelivered(chargeId: string): Promise<void>;
  listRefundable(userId: number, productId?: string): Promise<PurchaseRow[]>;
  markRefunded(chargeId: string): Promise<boolean>;
  listProductFiles(productId: string): Promise<StoredFile[]>;
  replaceProductFiles(productId: string, files: StoredFile[]): Promise<void>;
  getMedia(slot: string): Promise<string | null>;
  setMedia(slot: string, fileId: string, now: string): Promise<void>;
  getSession(userId: number): Promise<SessionRow | null>;
  setSession(userId: number, state: string, data: string | null, now: string): Promise<void>;
  clearSession(userId: number): Promise<void>;
  stats(): Promise<Stats>;
  enqueueBroadcast(text: string, createdBy: number, now: string): Promise<{ recipients: number }>;
  reclaimBroadcastLeases(staleBeforeIso: string): Promise<void>;
  leaseBroadcastBatch(limit: number, now: string): Promise<BroadcastJob[]>;
  finishBroadcastJob(
    id: number,
    status: "sent" | "pending" | "failed",
    error: string | null,
  ): Promise<void>;
}
