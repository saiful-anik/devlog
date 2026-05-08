/**
 * Database Connection Test
 * 
 * Run this file to verify your Supabase pooler connection is working:
 * npx tsx src/test/test-db-connection.ts
 */

import dotenv from "dotenv";

// Load environment variables FIRST before importing anything else
dotenv.config();

import { queryOne, closePool } from "../lib/db.js";

async function testDatabaseConnection() {
  console.log("🔧 Testing Supabase Database Connection...\n");

  // Check environment variables
  console.log("📋 Checking environment variables...");
  const required = [
    "SUPABASE_POOLER_CONNECTION_STRING",
    "SUPABASE_DB_PASS",
    "VITE_SUPABASE_URL",
  ];

  let missingVars = false;
  for (const env of required) {
    if (process.env[env]) {
      console.log(`  ✅ ${env}: Set`);
    } else {
      console.log(`  ❌ ${env}: Missing`);
      missingVars = true;
    }
  }

  if (missingVars) {
    console.log(
      "\n❌ Missing environment variables. Check your .env file.\n"
    );
    return false;
  }

  // Test database connection
  console.log("\n🔌 Testing database connection...");
  try {
    console.log(
      `  Connecting to: ${process.env.SUPABASE_POOLER_CONNECTION_STRING?.split("@")[1]}...`
    );
    const result = await queryOne<{ time: Date }>("SELECT NOW() as time");

    if (result?.time) {
      console.log(`  ✅ Connected successfully!`);
      console.log(`  📅 Server time: ${result.time}`);
      console.log("\n✅ All checks passed! Your database is connected.\n");
      return true;
    } else {
      console.log("  ❌ Query returned no data");
      return false;
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    const dbError = error as any;
    
    if (dbError?.code === "XX000" && errorMsg.includes("allow_list")) {
      console.log(`  ⚠️  Connection reached server but IP is not in allow list`);
      console.log(`  Solution: Add your IP address to Supabase project's IP allow list`);
      console.log(`  Or disable IP restrictions in Project Settings → Database\n`);
      return false;
    }
    
    console.log(`  ❌ Connection failed: ${errorMsg || "(No error message)"}`);
    if (error instanceof Error) {
      console.log(`  Error code: ${(error as any).code}`);
      console.log(`  Full error:`, error);
    }
    console.log("\nCommon issues:");
    console.log("  • Database password is incorrect");
    console.log("  • Network connectivity issue");
    console.log("  • Supabase project is paused");
    console.log("  • Connection string is malformed");
    console.log("  • IP address not in allow list\n");
    return false;
  } finally {
    await closePool();
  }
}

// Run the test
testDatabaseConnection()
  .then((success) => {
    process.exit(success ? 0 : 1);
  })
  .catch((error) => {
    console.error("Test error:", error);
    process.exit(1);
  });
