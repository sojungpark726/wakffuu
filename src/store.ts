// 내 왁뿌볼 보관함 — 브라우저 IndexedDB 에 최대 10개까지 저장 (껍질 이미지는 PNG Blob).
// IndexedDB 를 못 쓰는 환경(일부 사생활 보호 모드)에서는 이번 방문 동안만 메모리에 둔다.
import type { BallDesign } from "./design";

export const MAX_BALLS = 10;

export type BallSource = "basic" | "ai" | "shared";

export interface SavedBall {
  id: string;
  createdAt: number;
  source: BallSource;
  design: BallDesign;
  shell: Blob;
}

const DB_NAME = "wakppu";
const STORE = "balls";

let dbPromise: Promise<IDBDatabase> | null = null;
let openDb: IDBDatabase | null = null;
const memory = new Map<string, SavedBall>();
export let persistent = true;
let askedPersist = false;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "id" });
    req.onsuccess = () => {
      const db = (openDb = req.result);
      // 브라우저가 연결을 끊거나 다른 탭이 버전을 올리면 다음에 새로 연다
      db.onclose = () => forget(db);
      db.onversionchange = () => forget(db);
      resolve(db);
      askPersist();
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** 지금 연결을 버린다 (다음 요청 때 새로 연다) */
function forget(db: IDBDatabase) {
  if (db === openDb) {
    dbPromise = null;
    openDb = null;
  }
  try {
    db.close();
  } catch {
    /* 이미 닫힘 */
  }
}

/** 저장 공간이 부족해도 브라우저가 보관함을 함부로 지우지 않게 한 번만 부탁 */
function askPersist() {
  if (askedPersist) return;
  askedPersist = true;
  try {
    void navigator.storage?.persist?.()?.catch(() => {});
  } catch {
    /* 지원하지 않으면 그냥 넘어감 */
  }
}

/** 요청이 아니라 트랜잭션이 끝나야(complete) 성공 — 용량 초과(QuotaExceeded)도 실패로 알린다 */
function tx<T>(db: IDBDatabase, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = run(t.objectStore(STORE));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(req.error ?? t.error);
    t.onabort = () => reject(t.error ?? req.error ?? new Error("transaction aborted"));
  });
}

/**
 * IndexedDB 를 아예 못 여는 환경이면 이번 방문 동안 메모리로 바꾼다.
 * 열린 뒤의 오류는 연결을 새로 열어 한 번 더 해보고, 그래도 안 되면
 * 읽기는 메모리 값으로 대신하고 쓰기는 실패로 돌려준다 (보관 실패를 알릴 수 있게).
 */
async function safely<T>(idb: (db: IDBDatabase) => Promise<T>, fallback: () => T, write = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    if (!persistent) return fallback();
    let db: IDBDatabase;
    try {
      db = await open();
    } catch (e) {
      console.warn("[store] IndexedDB 를 열 수 없어 메모리에 보관", e);
      dbPromise = null;
      persistent = false;
      return fallback();
    }
    try {
      return await idb(db);
    } catch (e) {
      forget(db);
      if (attempt === 0) continue;
      if (write) throw e;
      console.warn("[store] 보관함을 읽지 못함", e);
      return fallback();
    }
  }
}

/** 최근에 넣은 것부터 */
export function listBalls(): Promise<SavedBall[]> {
  return safely(
    async (db) => (await tx<SavedBall[]>(db, "readonly", (s) => s.getAll())).sort((a, b) => b.createdAt - a.createdAt),
    () => [...memory.values()].sort((a, b) => b.createdAt - a.createdAt),
  );
}

export function getBall(id: string): Promise<SavedBall | undefined> {
  return safely(
    (db) => tx<SavedBall | undefined>(db, "readonly", (s) => s.get(id)),
    () => memory.get(id),
  );
}

export function putBall(ball: SavedBall): Promise<void> {
  return safely(
    async (db) => {
      await tx(db, "readwrite", (s) => s.put(ball));
    },
    () => {
      memory.set(ball.id, ball);
    },
    true,
  );
}

export function deleteBall(id: string): Promise<void> {
  return safely(
    async (db) => {
      await tx(db, "readwrite", (s) => s.delete(id));
    },
    () => {
      memory.delete(id);
    },
    true,
  );
}

export function newId(): string {
  return crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
