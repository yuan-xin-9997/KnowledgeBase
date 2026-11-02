import { db, newId, nowIso } from "./db.js";
import { hashPassword } from "./auth.js";
import { registerSchema } from "./registration.js";

/** Local-only bootstrap; the lock and marker also cover separate CLI processes. */
export async function initializeAdmin(input: unknown): Promise<void> {
  const body = registerSchema.parse(input);
  const passwordHash = await hashPassword(body.password);
  db.transaction(() => {
    if (db.prepare("SELECT 1 FROM app_settings WHERE key = 'admin_initialized'").get()
      || db.prepare("SELECT 1 FROM users LIMIT 1").get()) {
      throw new Error("已有用户或已完成初始化，拒绝重复初始化");
    }
    db.prepare(`INSERT INTO users(id,email,username,password_hash,display_name,role,created_at)
      VALUES(?,?,?,?,?,'admin',?)`).run(newId("usr"), body.email.toLowerCase(), body.username,
      passwordHash, body.displayName || body.username, nowIso());
    db.prepare("INSERT INTO app_settings(key,value) VALUES('admin_initialized','1')").run();
  }).immediate();
}
