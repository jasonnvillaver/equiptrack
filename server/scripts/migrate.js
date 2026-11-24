import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "../src/database.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, "../migrations");
const migrations = fs
  .readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .sort();

try {
  for (const migration of migrations) {
    const migrationPath = path.join(migrationsDir, migration);
    await pool.query(fs.readFileSync(migrationPath, "utf8"));
    console.log(`Applied ${migration}.`);
  }
  console.log("Database schema is ready.");
} catch (error) {
  console.error("Database migration failed.", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
