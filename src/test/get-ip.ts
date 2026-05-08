/**
 * Get Your Current IP Address
 * 
 * Shows what IP Supabase is seeing when you connect
 * Run: npx tsx src/test/get-ip.ts
 */

import dotenv from "dotenv";
dotenv.config();

import { queryOne, closePool } from "../lib/db.js";

async function getPublicIP() {
  console.log("🌐 Getting your IP address from Supabase...\n");

  try {
    const result = await queryOne<{ ip: string }>(
      "SELECT inet_client_addr() as ip"
    );
    console.log(`Your IP Address: ${result?.ip}\n`);
    console.log("Add this IP to Supabase IP Allow List:");
    console.log("  Settings → Database → Connection Pooling → IP Allow List\n");
  } catch (error) {
    const msg = (error as Error).message;
    
    // Extract IP from error message if available
    const ipMatch = msg.match(/\{([0-9, ]+)\}/);
    if (ipMatch) {
      const octets = ipMatch[1].split(", ").map(Number);
      const detectedIP = octets.join(".");
      console.log(`Your IP Address (detected from error): ${detectedIP}\n`);
      console.log("❌ This IP is NOT in the allow list yet.\n");
      console.log("Add this IP to Supabase IP Allow List:");
      console.log("  Settings → Database → Connection Pooling → IP Allow List\n");
    } else {
      console.log("Error:", msg);
    }
  } finally {
    await closePool();
  }
}

getPublicIP();
