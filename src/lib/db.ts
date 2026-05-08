import { Pool, QueryResult } from "pg";

// Parse connection string into config
function parseConnectionString(connStr: string) {
  const url = new URL(connStr);
  return {
    user: url.username,
    password: url.password,
    host: url.hostname,
    port: parseInt(url.port || "5432"),
    database: url.pathname.slice(1),
    ssl: { rejectUnauthorized: false }, // Required for Supabase
  };
}

// Lazy-initialize connection pool
let pool: Pool | null = null;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.SUPABASE_POOLER_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error(
        "SUPABASE_POOLER_CONNECTION_STRING environment variable is not set"
      );
    }

    pool = new Pool(parseConnectionString(connectionString));

    // Handle pool errors
    pool.on("error", (err) => {
      console.error("Unexpected error on idle client", err);
    });
  }

  return pool;
}

/**
 * Execute a query against the database
 * @param text - SQL query string
 * @param params - Query parameters (optional)
 */
export async function query<T = any>(
  text: string,
  params?: any[]
): Promise<QueryResult<T>> {
  const client = await getPool().connect();
  try {
    return await client.query<T>(text, params);
  } finally {
    client.release();
  }
}

/**
 * Execute a query and return just the rows
 * @param text - SQL query string
 * @param params - Query parameters (optional)
 */
export async function queryRows<T = any>(
  text: string,
  params?: any[]
): Promise<T[]> {
  const result = await query<T>(text, params);
  return result.rows;
}

/**
 * Get a single row from a query
 * @param text - SQL query string
 * @param params - Query parameters (optional)
 */
export async function queryOne<T = any>(
  text: string,
  params?: any[]
): Promise<T | null> {
  const result = await query<T>(text, params);
  return result.rows[0] ?? null;
}

/**
 * Close the connection pool
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
