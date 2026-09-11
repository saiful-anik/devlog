import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export type Env = {
  DATABASE_URL: string;
  CORS_ORIGIN: string;
  SCREENSHOTS: R2Bucket;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  SESSION_SECRET: string;
  ALLOWED_USERS: string;
  FRONTEND_URL: string;
};

export function createDb(env: Env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return drizzle({ client: neon(env.DATABASE_URL), schema });
}
