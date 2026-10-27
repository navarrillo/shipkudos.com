import pg, { type PoolClient, type QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";
let pool: pg.Pool | undefined;
export function getPool() {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL is not configured");
  pool ??= new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    max: Number(process.env.DB_POOL_SIZE || 8),
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 30000,
    statement_timeout: 10000,
    application_name: "shipkudos",
    options: "-c timezone=UTC",
  });
  return pool;
}
export const getDb = () => drizzle(getPool(), { schema });
export const sql = async <T extends QueryResultRow = QueryResultRow>(
  query: string,
  params: unknown[] = [],
) => (await getPool().query<T>(query, params)).rows;
export async function transaction<T>(fn: (client: PoolClient) => Promise<T>) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
