/**
 * The offline clock queue (ADR 006). A clock action that cannot reach the
 * server is kept on the device, in FIFO order, and synced later through
 * `rpc_clock_offline`. Storage sits behind `QueueStorage` so the logic is
 * testable with the in-memory version; the browser uses IndexedDB.
 */
import { nextShiftState, type ShiftState } from "@cloxa/domain";

export type QueuedClockType = "clock_in" | "clock_out" | "break_start" | "break_end";

export interface QueueEntry {
  /**
   * Whose action this is. On a shared phone one person's entry must never be
   * synced in someone else's session, so sync only takes the signed-in
   * employee's entries.
   */
  readonly employeeId: string;
  readonly type: QueuedClockType;
  readonly idempotencyKey: string;
  readonly siteId: string;
  /** ISO 8601 (UTC): the device time of the button press. */
  readonly capturedAt: string;
  /** Sync attempts that failed for a transient reason. */
  readonly attempts: number;
}

export interface QueueStorage {
  /** Every entry, oldest first. */
  list(): Promise<QueueEntry[]>;
  /** Appends at the end; an entry with the same key is kept as it is. */
  add(entry: QueueEntry): Promise<void>;
  /** Replaces the entry with the same key, keeping its place. */
  update(entry: QueueEntry): Promise<void>;
  remove(idempotencyKey: string): Promise<void>;
}

/** For tests and for browsers where IndexedDB fails to open. */
export function memoryQueueStorage(initial: readonly QueueEntry[] = []): QueueStorage {
  let entries = [...initial];
  return {
    list: () => Promise.resolve([...entries]),
    add(entry) {
      if (!entries.some((e) => e.idempotencyKey === entry.idempotencyKey)) {
        entries = [...entries, entry];
      }
      return Promise.resolve();
    },
    update(entry) {
      entries = entries.map((e) =>
        e.idempotencyKey === entry.idempotencyKey ? entry : e,
      );
      return Promise.resolve();
    },
    remove(idempotencyKey) {
      entries = entries.filter((e) => e.idempotencyKey !== idempotencyKey);
      return Promise.resolve();
    },
  };
}

// IndexedDB ---------------------------------------------------------------------------------

const DB_NAME = "cloxa-offline";
const DB_VERSION = 1;
const STORE = "clock-queue";
const KEY_INDEX = "idempotencyKey";

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("indexeddb_error"));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb_error"));
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb_abort"));
  });
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  const open = factory.open(DB_NAME, DB_VERSION);
  open.onupgradeneeded = () => {
    // An auto-increment primary key keeps insertion order: getAll() is FIFO.
    const store = open.result.createObjectStore(STORE, { autoIncrement: true });
    store.createIndex(KEY_INDEX, KEY_INDEX, { unique: true });
  };
  return request(open);
}

/** The browser queue, or null when IndexedDB is not available. */
export function indexedDbQueueStorage(
  factory: IDBFactory | undefined = globalThis.indexedDB,
): QueueStorage | null {
  if (!factory) return null;
  let database: Promise<IDBDatabase> | null = null;
  const db = () => (database ??= openDatabase(factory));

  async function withStore<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore) => Promise<T>,
  ): Promise<T> {
    const tx = (await db()).transaction(STORE, mode);
    const result = await work(tx.objectStore(STORE));
    await done(tx);
    return result;
  }

  return {
    list: () =>
      withStore("readonly", (store) =>
        request(store.getAll() as IDBRequest<QueueEntry[]>),
      ),
    add: (entry) =>
      withStore("readwrite", async (store) => {
        const existing = await request(
          store.index(KEY_INDEX).getKey(entry.idempotencyKey),
        );
        if (existing === undefined) await request(store.add(entry));
      }),
    update: (entry) =>
      withStore("readwrite", async (store) => {
        const key = await request(store.index(KEY_INDEX).getKey(entry.idempotencyKey));
        if (key !== undefined) await request(store.put(entry, key));
      }),
    remove: (idempotencyKey) =>
      withStore("readwrite", async (store) => {
        const key = await request(store.index(KEY_INDEX).getKey(idempotencyKey));
        if (key !== undefined) await request(store.delete(key));
      }),
  };
}

// Sync ----------------------------------------------------------------------------------------

/** What the server made of one entry; `retry` keeps it queued. */
export type SyncOutcome =
  | { outcome: "recorded" }
  | { outcome: "correction_requested"; reason: string | null }
  | { outcome: "rejected"; reason: string }
  | { outcome: "retry" };

export type SettledOutcome = Exclude<SyncOutcome, { outcome: "retry" }>;

export interface SyncReport {
  /** Entries the server answered, in queue order. They are gone from the queue. */
  settled: { entry: QueueEntry; result: SettledOutcome }[];
  /** A transient failure stopped the run; the rest waits for the next one. */
  stopped: boolean;
}

export function pendingFor(
  entries: readonly QueueEntry[],
  employeeId: string,
): QueueEntry[] {
  return entries.filter((entry) => entry.employeeId === employeeId);
}

/**
 * Sends the employee's entries oldest first. Stops at the first transient
 * failure, so a later action never reaches the server before an earlier one.
 * A throwing `send` counts as transient (the network is down again).
 */
export async function syncQueue(
  storage: QueueStorage,
  employeeId: string,
  send: (entry: QueueEntry) => Promise<SyncOutcome>,
): Promise<SyncReport> {
  const settled: SyncReport["settled"] = [];
  for (const entry of pendingFor(await storage.list(), employeeId)) {
    let result: SyncOutcome;
    try {
      result = await send(entry);
    } catch {
      result = { outcome: "retry" };
    }
    if (result.outcome === "retry") {
      await storage.update({ ...entry, attempts: entry.attempts + 1 });
      return { settled, stopped: true };
    }
    await storage.remove(entry.idempotencyKey);
    settled.push({ entry, result });
  }
  return { settled, stopped: false };
}

// Optimistic state ------------------------------------------------------------------------------

export interface DisplayedState {
  state: ShiftState;
  /** Start of the open shift, like `rpc_my_status`; null when off. */
  since: number | null;
}

/**
 * The state the employee sees: the server's, with the queued actions applied
 * on top. A queued action that does not fit is skipped here; the server
 * turns it into a correction request anyway.
 */
export function displayedState(
  server: DisplayedState,
  pending: readonly QueueEntry[],
): DisplayedState {
  let { state, since } = server;
  for (const entry of pending) {
    const next = nextShiftState(state, entry.type);
    if (next === undefined) continue;
    if (entry.type === "clock_in") since = Date.parse(entry.capturedAt);
    if (next === "off") since = null;
    state = next;
  }
  return { state, since };
}
