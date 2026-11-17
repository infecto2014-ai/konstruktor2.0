import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { Pool } from "pg";

export type StoredAsset = {
  id: string;
  tokenHash: string;
  width: number;
  height: number;
  mime: string;
  name: string;
  key: string;
};
export type StoredDocument = {
  id: string;
  tokenHash: string;
  body: unknown;
  createdAt: string;
};
export type StoredOrder = {
  id: string;
  tokenHash: string;
  idempotencyKey: string;
  fingerprint: string;
  body: unknown;
  createdAt: string;
};
type AssetDbRow = {
  id: string;
  token_hash: string;
  width: number;
  height: number;
  mime: string;
  name: string;
  key: string;
};
type ProjectDbRow = {
  id: string;
  token_hash: string;
  body: unknown;
  created_at: string;
};
type OrderDbRow = {
  id: string;
  token_hash: string;
  idempotency_key: string;
  fingerprint: string;
  body: unknown;
  created_at: string;
};

export interface Storage {
  saveAsset(row: StoredAsset, bytes: Buffer): Promise<void>;
  getAsset(id: string): Promise<{ row: StoredAsset; bytes: Buffer } | null>;
  saveProject(row: StoredDocument): Promise<void>;
  getProject(id: string): Promise<StoredDocument | null>;
  createOrder(
    row: StoredOrder,
  ): Promise<{ row: StoredOrder; created: boolean }>;
  getOrder(id: string): Promise<StoredOrder | null>;
  close(): Promise<void>;
}

class FileObjects {
  private s3?: S3Client;
  private bucket: string;
  private root: string;
  constructor(root: string) {
    this.root = join(root, "assets");
    this.bucket = process.env.S3_BUCKET || "";
    if (process.env.STORAGE_DRIVER === "s3") {
      if (!this.bucket)
        throw new Error("S3_BUCKET is required for STORAGE_DRIVER=s3");
      this.s3 = new S3Client({
        region: process.env.AWS_REGION || "us-east-1",
        endpoint: process.env.S3_ENDPOINT,
        forcePathStyle: !!process.env.S3_ENDPOINT,
      });
    }
  }
  async put(key: string, bytes: Buffer, mime: string) {
    if (this.s3)
      await this.s3.send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: bytes,
          ContentType: mime,
        }),
      );
    else {
      await mkdir(this.root, { recursive: true });
      await writeFile(join(this.root, key), bytes, { flag: "wx" });
    }
  }
  async get(key: string): Promise<Buffer> {
    if (this.s3) {
      const out = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return Buffer.from(await out.Body!.transformToByteArray());
    }
    return readFile(join(this.root, key));
  }
  async remove(key: string) {
    if (this.s3)
      await this.s3.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
      );
    else {
      const { unlink } = await import("node:fs/promises");
      await unlink(join(this.root, key)).catch(() => {});
    }
  }
}

/** Local SQLite metadata store; orders are committed with their idempotency key atomically. */
class SqliteStorage implements Storage {
  private db: DatabaseSync;
  private objects: FileObjects;
  constructor(root: string) {
    this.db = new DatabaseSync(join(root, "constructor.sqlite"));
    this.objects = new FileObjects(root);
    this.db.exec(`PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL, mime TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);`);
  }
  async saveAsset(row: StoredAsset, bytes: Buffer) {
    await this.objects.put(row.key, bytes, row.mime);
    try {
      this.db
        .prepare("INSERT INTO assets VALUES(?,?,?,?,?,?,?)")
        .run(
          row.id,
          row.tokenHash,
          row.width,
          row.height,
          row.mime,
          row.name,
          row.key,
        );
    } catch (e) {
      await this.objects.remove(row.key);
      throw e;
    }
  }
  async getAsset(id: string) {
    const r = this.db.prepare("SELECT * FROM assets WHERE id=?").get(id) as
      AssetDbRow | undefined;
    return r
      ? {
          row: {
            id: r.id,
            tokenHash: r.token_hash,
            width: r.width,
            height: r.height,
            mime: r.mime,
            name: r.name,
            key: r.key,
          },
          bytes: await this.objects.get(r.key),
        }
      : null;
  }
  async saveProject(r: StoredDocument) {
    this.db
      .prepare("INSERT INTO projects VALUES(?,?,?,?)")
      .run(r.id, r.tokenHash, JSON.stringify(r.body), r.createdAt);
  }
  async getProject(id: string) {
    const r = this.db.prepare("SELECT * FROM projects WHERE id=?").get(id) as
      ProjectDbRow | undefined;
    return r
      ? {
          id: r.id,
          tokenHash: r.token_hash,
          body:
            typeof r.body === "string"
              ? (JSON.parse(r.body) as unknown)
              : r.body,
          createdAt: r.created_at,
        }
      : null;
  }
  async createOrder(r: StoredOrder) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const old = this.db
        .prepare("SELECT * FROM orders WHERE idempotency_key=?")
        .get(r.idempotencyKey) as OrderDbRow | undefined;
      if (old) {
        this.db.exec("COMMIT");
        return {
          row: {
            id: old.id,
            tokenHash: old.token_hash,
            idempotencyKey: old.idempotency_key,
            fingerprint: old.fingerprint,
            body: JSON.parse(String(old.body)) as unknown,
            createdAt: old.created_at,
          },
          created: false,
        };
      }
      this.db
        .prepare("INSERT INTO orders VALUES(?,?,?,?,?,?)")
        .run(
          r.id,
          r.tokenHash,
          r.idempotencyKey,
          r.fingerprint,
          JSON.stringify(r.body),
          r.createdAt,
        );
      this.db.exec("COMMIT");
      return { row: r, created: true };
    } catch (e) {
      try {
        this.db.exec("ROLLBACK");
      } catch {}
      throw e;
    }
  }
  async getOrder(id: string) {
    const r = this.db.prepare("SELECT * FROM orders WHERE id=?").get(id) as
      OrderDbRow | undefined;
    return r
      ? {
          id: r.id,
          tokenHash: r.token_hash,
          idempotencyKey: r.idempotency_key,
          fingerprint: r.fingerprint,
          body: JSON.parse(String(r.body)) as unknown,
          createdAt: r.created_at,
        }
      : null;
  }
  async close() {
    this.db.close();
  }
}

/** PostgreSQL metadata adapter. The order insert and idempotency key share one transaction. */
class PgStorage implements Storage {
  private pool: Pool;
  private objects: FileObjects;
  constructor(root: string) {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.PGSSL === "disable" ? false : undefined,
    });
    this.objects = new FileObjects(root);
  }
  async init() {
    await this.pool
      .query(`CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, width INT NOT NULL, height INT NOT NULL, mime TEXT NOT NULL, name TEXT NOT NULL, key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, body JSONB NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders(id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, fingerprint TEXT NOT NULL, body JSONB NOT NULL, created_at TEXT NOT NULL)`);
  }
  async saveAsset(r: StoredAsset, b: Buffer) {
    await this.objects.put(r.key, b, r.mime);
    try {
      await this.pool.query("INSERT INTO assets VALUES($1,$2,$3,$4,$5,$6,$7)", [
        r.id,
        r.tokenHash,
        r.width,
        r.height,
        r.mime,
        r.name,
        r.key,
      ]);
    } catch (e) {
      await this.objects.remove(r.key);
      throw e;
    }
  }
  async getAsset(id: string) {
    const q = await this.pool.query<AssetDbRow>(
      "SELECT * FROM assets WHERE id=$1",
      [id],
    );
    const r = q.rows[0];
    return r
      ? {
          row: {
            id: r.id,
            tokenHash: r.token_hash,
            width: r.width,
            height: r.height,
            mime: r.mime,
            name: r.name,
            key: r.key,
          },
          bytes: await this.objects.get(r.key),
        }
      : null;
  }
  async saveProject(r: StoredDocument) {
    await this.pool.query("INSERT INTO projects VALUES($1,$2,$3,$4)", [
      r.id,
      r.tokenHash,
      JSON.stringify(r.body),
      r.createdAt,
    ]);
  }
  async getProject(id: string) {
    const q = await this.pool.query<ProjectDbRow>(
      "SELECT * FROM projects WHERE id=$1",
      [id],
    );
    const r = q.rows[0];
    return r
      ? {
          id: r.id,
          tokenHash: r.token_hash,
          body: r.body,
          createdAt: r.created_at,
        }
      : null;
  }
  async createOrder(r: StoredOrder) {
    const c = await this.pool.connect();
    try {
      await c.query("BEGIN");
      const put = await c.query<{ id: string }>(
        "INSERT INTO orders VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING RETURNING id",
        [
          r.id,
          r.tokenHash,
          r.idempotencyKey,
          r.fingerprint,
          JSON.stringify(r.body),
          r.createdAt,
        ],
      );
      if (put.rowCount) {
        await c.query("COMMIT");
        return { row: r, created: true };
      }
      const old = await c.query<OrderDbRow>(
        "SELECT * FROM orders WHERE idempotency_key=$1",
        [r.idempotencyKey],
      );
      await c.query("COMMIT");
      const x = old.rows[0];
      return {
        row: {
          id: x.id,
          tokenHash: x.token_hash,
          idempotencyKey: x.idempotency_key,
          fingerprint: x.fingerprint,
          body: x.body,
          createdAt: x.created_at,
        },
        created: false,
      };
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  async getOrder(id: string) {
    const q = await this.pool.query<OrderDbRow>(
      "SELECT * FROM orders WHERE id=$1",
      [id],
    );
    const r = q.rows[0];
    return r
      ? {
          id: r.id,
          tokenHash: r.token_hash,
          idempotencyKey: r.idempotency_key,
          fingerprint: r.fingerprint,
          body: r.body,
          createdAt: r.created_at,
        }
      : null;
  }
  async close() {
    await this.pool.end();
  }
}
export async function createStorage(root: string): Promise<Storage> {
  await mkdir(root, { recursive: true });
  if (process.env.DATABASE_URL) {
    const p = new PgStorage(root);
    await p.init();
    return p;
  }
  return new SqliteStorage(root);
}
