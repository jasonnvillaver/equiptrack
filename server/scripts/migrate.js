import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/database.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, "../migrations/001_initial.sql");

try {
  await pool.query(fs.readFileSync(migrationPath, "utf8"));
  console.log("Database schema is ready.");
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
