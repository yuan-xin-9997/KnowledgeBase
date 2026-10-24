import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const source = path.join(root, "src", "schema.sql");
const target = path.join(root, "dist", "schema.sql");
fs.copyFileSync(source, target);
console.log(`[build] copied ${source} -> ${target}`);
