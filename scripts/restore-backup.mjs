import path from "node:path";
import { restoreSnapshot } from "../server/dist/services/backup-files.js";
const [backup, target] = process.argv.slice(2);
if (!backup || !target) {
  console.error("用法：node scripts/restore-backup.mjs <备份目录> <不存在的恢复目录>");
  process.exitCode = 1;
} else {
  try { const counts = await restoreSnapshot(path.resolve(backup), path.resolve(target)); console.log("已恢复至独立目录，完整性和密钥验证通过：", counts); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
