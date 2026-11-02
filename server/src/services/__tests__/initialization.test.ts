import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import Fastify from "fastify";
import cookie from "@fastify/cookie";

let directory: string;
let db: typeof import("../../db.js").db;
let initialize: typeof import("../../initialize.js").initializeAdmin;
let app: ReturnType<typeof Fastify>;
const account = { email: "owner@example.test", username: "owner", password: "OnlyAFakeTestPassword!" };
beforeEach(async () => {
  vi.resetModules();
  directory = fs.mkdtempSync(path.join(os.tmpdir(), "kb-init-"));
  vi.stubEnv("DATA_DIR", directory);
  vi.stubEnv("ALLOW_REGISTRATION", "true");
  db = (await import("../../db.js")).db;
  initialize = (await import("../../initialize.js")).initializeAdmin;
  app = Fastify();
  await app.register(cookie);
  await app.register((await import("../../routes/auth.js")).default);
});
afterEach(async () => {
  await app.close();
  db.close();
  vi.unstubAllEnvs();
  if (path.dirname(directory) !== os.tmpdir() || !path.basename(directory).startsWith("kb-init-")) throw new Error("Invalid test directory");
  fs.rmSync(directory, { recursive: true, force: true });
});
const register = (username: string) => app.inject({ method: "POST", url: "/api/auth/register",
  payload: { ...account, username, email: `${username}@example.test`, role: "admin" } });

it("blocks empty-database registration even when enabled and rejects invalid initialization", async () => {
  expect((await register("attacker")).statusCode).toBe(403);
  await expect(initialize({ ...account, password: "short" })).rejects.toThrow();
  expect(db.prepare("SELECT * FROM users").all()).toHaveLength(0);
  expect(db.prepare("SELECT * FROM app_settings WHERE key='admin_initialized'").get()).toBeUndefined();
});

it("creates exactly one administrator under concurrency; registration always creates users", async () => {
  const results = await Promise.allSettled([initialize(account), initialize({ ...account, username: "another" }), register("racer")]);
  expect(results.slice(0, 2).filter(result => result.status === "fulfilled")).toHaveLength(1);
  expect(db.prepare("SELECT * FROM users WHERE role='admin'").all()).toHaveLength(1);
  const responses = await Promise.all([register("first"), register("second")]);
  expect(responses.map(response => response.statusCode)).toEqual([201, 201]);
  expect(responses.map(response => response.json().user.role)).toEqual(["user", "user"]);
  const badLogin = await app.inject({ method: "POST", url: "/api/auth/login", payload: { account: "owner", password: "WrongFakePassword" } });
  expect(badLogin.statusCode).toBe(401);
});

it("rolls back the account if writing the initialization marker fails", async () => {
  db.exec("CREATE TRIGGER fail_init BEFORE INSERT ON app_settings WHEN NEW.key='admin_initialized' BEGIN SELECT RAISE(ABORT,'interrupted'); END");
  await expect(initialize(account)).rejects.toThrow("interrupted");
  expect(db.prepare("SELECT * FROM users").all()).toHaveLength(0);
  db.exec("DROP TRIGGER fail_init");
  await initialize(account);
});

it("serializes administrators across independent initialization processes", async () => {
  const run = () => new Promise<number | null>((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      import { initializeAdmin } from ${JSON.stringify(new URL("../../initialize.ts", import.meta.url).href)};
      import { db } from ${JSON.stringify(new URL("../../db.ts", import.meta.url).href)};
      try { await initializeAdmin(${JSON.stringify(account)}); }
      catch { process.exitCode = 2; }
      finally { db.close(); }
    `], { env: { ...process.env, DATA_DIR: directory }, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", resolve);
  });
  expect((await Promise.all([run(), run()])).sort()).toEqual([0, 2]);
  expect(db.prepare("SELECT * FROM users").all()).toHaveLength(1);
  expect(db.prepare("SELECT role FROM users").get()).toEqual({ role: "admin" });
});

it("recovers from a process exiting inside an uncommitted initialization transaction", async () => {
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { db } from ${JSON.stringify(new URL("../../db.ts", import.meta.url).href)};
    db.exec("BEGIN IMMEDIATE");
    db.prepare("INSERT INTO users(id,email,username,password_hash,role,created_at) VALUES('partial','partial@example.test','partial','fake','admin','now')").run();
    process.exit(17);
  `], { env: { ...process.env, DATA_DIR: directory }, encoding: "utf8" });
  expect(child.status, child.stderr).toBe(17);
  expect(db.prepare("SELECT * FROM users").all()).toHaveLength(0);
  await initialize(account);
});

it("persists initialization across restart, even after users are removed", async () => {
  await initialize(account);
  const secret = fs.readFileSync(path.join(directory, "secret.key"), "utf8");
  db.prepare("DELETE FROM users").run();
  db.close();
  vi.resetModules();
  db = (await import("../../db.js")).db;
  initialize = (await import("../../initialize.js")).initializeAdmin;
  await expect(initialize(account)).rejects.toThrow("已完成初始化");
  expect(fs.readFileSync(path.join(directory, "secret.key"), "utf8")).toBe(secret);
});

it("migrates existing users without changing their role, sessions or secret", async () => {
  db.prepare("INSERT INTO users(id,email,username,password_hash,role,created_at) VALUES('legacy',?,?,?,'user',?)")
    .run(account.email, account.username, "legacy-hash", "2020-01-01");
  db.prepare("INSERT INTO sessions(id,user_id,token_hash,expires_at,created_at) VALUES('session','legacy','fake-token','2099-01-01','2020-01-01')").run();
  db.close();
  vi.resetModules();
  db = (await import("../../db.js")).db;
  initialize = (await import("../../initialize.js")).initializeAdmin;
  await expect(initialize(account)).rejects.toThrow();
  expect(db.prepare("SELECT role FROM users WHERE id='legacy'").get()).toEqual({ role: "user" });
  expect(db.prepare("SELECT token_hash FROM sessions").get()).toEqual({ token_hash: "fake-token" });
  expect(db.prepare("SELECT value FROM app_settings WHERE key='admin_initialized'").get()).toEqual({ value: "1" });
});

it("keeps ordinary registration disabled by default after initialization", async () => {
  await initialize(account);
  expect((await import("../../config.js")).config.allowRegistration).toBe(true);
  vi.stubEnv("ALLOW_REGISTRATION", undefined);
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
    import { config } from ${JSON.stringify(new URL("../../config.ts", import.meta.url).href)};
    console.log(config.allowRegistration);
  `], { env: { ...process.env, DATA_DIR: directory }, encoding: "utf8" });
  expect(child.status, child.stderr).toBe(0);
  expect(child.stdout.trim()).toBe("false");
  (await import("../../config.js")).config.allowRegistration = false;
  expect((await register("closed")).statusCode).toBe(403);
});
