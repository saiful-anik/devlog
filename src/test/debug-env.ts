import dotenv from "dotenv";

// Load environment variables
dotenv.config();

console.log("Connection String:", process.env.SUPABASE_POOLER_CONNECTION_STRING);
console.log("DB Pass:", process.env.SUPABASE_DB_PASS);

// Try to parse it manually
const connStr = process.env.SUPABASE_POOLER_CONNECTION_STRING;
if (connStr) {
  const url = new URL(connStr);
  console.log("\nParsed URL:");
  console.log("  Protocol:", url.protocol);
  console.log("  Username:", url.username);
  console.log("  Password:", url.password ? "***" : "none");
  console.log("  Hostname:", url.hostname);
  console.log("  Port:", url.port);
  console.log("  Pathname:", url.pathname);
}
