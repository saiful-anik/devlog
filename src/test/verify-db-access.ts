/**
 * Full Database Access Verification Test
 * 
 * Checks:
 * - SELECT access
 * - INSERT access
 * - UPDATE access
 * - DELETE access
 * - CREATE TABLE access
 * - Schema information
 * 
 * Run: npx tsx src/test/verify-db-access.ts
 */

import dotenv from "dotenv";

// Load environment variables FIRST
dotenv.config();

import { query, queryRows, queryOne, closePool } from "../lib/db.js";

async function verifyDatabaseAccess() {
  console.log("🔐 Full Database Access Verification\n");

  const checks = [];

  try {
    // 1. Check SELECT access
    console.log("1️⃣  Testing SELECT access...");
    try {
      const result = await queryOne<{ count: number }>(
        "SELECT COUNT(*) as count FROM information_schema.tables WHERE table_schema = 'public'"
      );
      console.log(`   ✅ SELECT: Can access tables (${result?.count || 0} tables)`);
      checks.push(true);
    } catch (e) {
      console.log(`   ❌ SELECT: ${(e as Error).message}`);
      checks.push(false);
    }

    // 2. Check table list access
    console.log("\n2️⃣  Checking available tables...");
    try {
      const tables = await queryRows<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' LIMIT 10"
      );
      if (tables.length > 0) {
        console.log(`   ✅ Found ${tables.length} tables:`);
        tables.forEach((t) => console.log(`      - ${t.table_name}`));
      } else {
        console.log("   ℹ️  No tables in public schema yet");
      }
      checks.push(true);
    } catch (e) {
      console.log(`   ❌ Error listing tables: ${(e as Error).message}`);
      checks.push(false);
    }

    // 3. Check CREATE TABLE access
    console.log("\n3️⃣  Testing CREATE TABLE access...");
    try {
      const testTable = `test_access_${Date.now()}`;
      await query(`CREATE TABLE ${testTable} (id SERIAL PRIMARY KEY, data TEXT)`);
      console.log(`   ✅ CREATE TABLE: Successfully created ${testTable}`);
      checks.push(true);

      // 4. Test INSERT
      console.log("\n4️⃣  Testing INSERT access...");
      try {
        await query(`INSERT INTO ${testTable} (data) VALUES ($1)`, [
          "test data",
        ]);
        console.log(`   ✅ INSERT: Successfully inserted data`);
        checks.push(true);
      } catch (e) {
        console.log(`   ❌ INSERT: ${(e as Error).message}`);
        checks.push(false);
      }

      // 5. Test UPDATE
      console.log("\n5️⃣  Testing UPDATE access...");
      try {
        await query(`UPDATE ${testTable} SET data = $1 WHERE id = 1`, [
          "updated data",
        ]);
        console.log(`   ✅ UPDATE: Successfully updated data`);
        checks.push(true);
      } catch (e) {
        console.log(`   ❌ UPDATE: ${(e as Error).message}`);
        checks.push(false);
      }

      // 6. Test DELETE
      console.log("\n6️⃣  Testing DELETE access...");
      try {
        await query(`DELETE FROM ${testTable} WHERE id = 1`);
        console.log(`   ✅ DELETE: Successfully deleted data`);
        checks.push(true);
      } catch (e) {
        console.log(`   ❌ DELETE: ${(e as Error).message}`);
        checks.push(false);
      }

      // Cleanup: Drop test table
      console.log("\n🧹 Cleaning up test table...");
      try {
        await query(`DROP TABLE ${testTable}`);
        console.log(`   ✅ Dropped ${testTable}`);
      } catch (e) {
        console.log(`   ⚠️  Could not drop test table: ${(e as Error).message}`);
      }
    } catch (e) {
      console.log(`   ❌ CREATE TABLE: ${(e as Error).message}`);
      checks.push(false);
    }

    // 7. Check user/role info
    console.log("\n7️⃣  Checking database user info...");
    try {
      const userInfo = await queryOne<{ usename: string }>(
        "SELECT usename FROM pg_user WHERE usename = current_user"
      );
      console.log(`   ✅ Current user: ${userInfo?.usename}`);
      checks.push(true);
    } catch (e) {
      console.log(`   ❌ Could not get user info: ${(e as Error).message}`);
      checks.push(false);
    }

    // Summary
    console.log("\n" + "=".repeat(50));
    const passed = checks.filter(Boolean).length;
    const total = checks.length;
    console.log(`\n✅ Results: ${passed}/${total} tests passed`);

    if (passed === total) {
      console.log("\n🎉 FULL DATABASE ACCESS CONFIRMED!");
      console.log("You have complete read/write permissions on the database.\n");
    } else if (passed > total / 2) {
      console.log("\n⚠️  PARTIAL ACCESS - Some operations may be restricted\n");
    } else {
      console.log("\n❌ LIMITED ACCESS - Most operations are blocked\n");
    }
  } finally {
    await closePool();
  }
}

verifyDatabaseAccess()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("Test error:", error);
    process.exit(1);
  });
