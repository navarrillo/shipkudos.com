import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { PgBoss } from "pg-boss";
import { getPool } from "./db";
const pool = getPool(),
  client = await pool.connect();
try {
  await client.query(
    "SELECT pg_advisory_lock(hashtext('shipclout-migrations'))",
  );
  await client.query(
    "CREATE TABLE IF NOT EXISTS app_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())",
  );
  for (const name of (await readdir("migrations"))
    .filter((n) => n.endsWith(".sql"))
    .sort()) {
    const content = await readFile(`migrations/${name}`, "utf8"),
      checksum = createHash("sha256").update(content).digest("hex");
    const {
      rows: [existing],
    } = await client.query(
      "SELECT checksum FROM app_migrations WHERE name=$1",
      [name],
    );
    if (existing) {
      if (existing.checksum !== checksum)
        throw new Error(`Modified applied migration: ${name}`);
      continue;
    }
    await client.query("BEGIN");
    try {
      await client.query(content);
      await client.query(
        "INSERT INTO app_migrations(name,checksum) VALUES($1,$2)",
        [name, checksum],
      );
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
    console.log(JSON.stringify({ event: "migration_applied", name }));
  }
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL,
    max: 1,
    migrate: true,
    supervise: false,
    schedule: false,
  });
  boss.on("error", () => console.error("Queue migration failed"));
  await boss.start();
  await boss.createQueue("github-sync", {
    policy: "exclusive",
    retryLimit: 4,
    retryDelay: 60,
    retryBackoff: true,
    expireInSeconds: 300,
    retentionSeconds: 7 * 86400,
  });
  await boss.stop();
} finally {
  await client.query(
    "SELECT pg_advisory_unlock(hashtext('shipclout-migrations'))",
  );
  client.release();
  await pool.end();
}
