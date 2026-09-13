import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Env = {
  DATABASE_URL: string;
  CORS_ORIGIN: string;
  SCREENSHOTS: R2Bucket;
  NEON_AUTH_URL: string;
  AUTH_RATE_LIMIT: RateLimit;
  USER_RATE_LIMIT: RateLimit;
  UPLOAD_RATE_LIMIT: RateLimit;
};

export function createDb(env: Env) {
  return drizzle({ client: createSql(env), schema });
}

export function createSql(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return neon(env.DATABASE_URL);
}
