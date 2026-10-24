import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const cwd = process.cwd();

function firstExisting(candidates: string[]): string | null {
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isDirectory()) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

export const config = {
  host: process.env.HOST || "0.0.0.0",
  port: Number(process.env.PORT || 36080),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(cwd, "data")),
  webDist:
    process.env.WEB_DIST ||
    firstExisting([
      path.join(cwd, "web", "dist"),
      path.join(cwd, "..", "web", "dist"),
      path.join(cwd, "public"),
    ]),
  appOrigin: process.env.APP_ORIGIN || "",
  allowRegistration: process.env.ALLOW_REGISTRATION !== "false",
  sessionDays: Number(process.env.SESSION_DAYS || 30),
  syncScheduler: process.env.SYNC_SCHEDULER !== "false",
  logLevel: process.env.LOG_LEVEL || "info",
};

fs.mkdirSync(config.dataDir, { recursive: true });

export const dbPath = path.join(config.dataDir, "knowledge.db");

function loadSecret(): string {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const file = path.join(config.dataDir, "secret.key");
  try {
    return fs.readFileSync(file, "utf8").trim();
  } catch {
    const secret = crypto.randomBytes(48).toString("base64url");
    fs.writeFileSync(file, secret, { mode: 0o600 });
    return secret;
  }
}

export const appSecret = loadSecret();
