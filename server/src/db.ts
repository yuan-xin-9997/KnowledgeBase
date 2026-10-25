import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { config, dbPath } from "./config.js";

const here = path.dirname(fileURLToPath(import.meta.url));

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("busy_timeout = 5000");

const schemaCandidates = [
  path.join(here, "schema.sql"),
  path.join(here, "..", "src", "schema.sql"),
  path.join(process.cwd(), "src", "schema.sql"),
];
const schemaFile = schemaCandidates.find((candidate) => fs.existsSync(candidate));
if (!schemaFile) {
  throw new Error(`schema.sql not found in: ${schemaCandidates.join(", ")}`);
}
db.exec(fs.readFileSync(schemaFile, "utf8"));

const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{ name: string }>;
if (!userColumns.some((column) => column.name === "active")) {
  db.exec("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
}

export { db };

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(prefix: string): string {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "")}`;
}

/** Run a set of statements in a single transaction. */
export function tx<T>(fn: () => T): T {
  return db.transaction(fn)();
}

export function getSetting(key: string): string | null {
  const row = db.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    "INSERT INTO app_settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

export const paths = {
  dataDir: config.dataDir,
  dbPath,
};
