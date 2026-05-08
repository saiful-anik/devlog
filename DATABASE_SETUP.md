# Database Setup Guide

## Overview

Your application is now configured to connect directly to Supabase PostgreSQL database using the **pooler connection string** for optimal performance.

## Architecture

```
Frontend (React/Vite)  
    ↓
Backend/API (Node.js)
    ↓
Supabase Pooler (pgBouncer)
    ↓
Supabase PostgreSQL Database
```

## Environment Variables

Your `.env` file contains:

- **`SUPABASE_POOLER_CONNECTION_STRING`** - For server-side database operations (uses connection pooling)
- **`SUPABASE_DB_PASS`** - Database password
- **`VITE_SUPABASE_URL`** - For client-side SDK (browser)
- **`VITE_SUPABASE_PUBLISHABLE_DEFAULT_KEY`** - For client-side authentication

## Usage

### 1. Direct Database Queries (Server-Side)

Use the database module in Node.js/backend contexts:

```typescript
import { queryRows, queryOne } from "@/lib/db";

// Get all records
const users = await queryRows("SELECT * FROM users");

// Get single record
const user = await queryOne("SELECT * FROM users WHERE id = $1", [userId]);

// Execute any query
import { query } from "@/lib/db";
const result = await query(
  "INSERT INTO projects (name, user_id) VALUES ($1, $2) RETURNING *",
  [projectName, userId]
);
```

### 2. Using Database Helpers

Pre-built helper functions are available in `src/lib/db-helpers.ts`:

```typescript
import {
  getAllUsers,
  getUserById,
  insertProject,
  updateProject,
  deleteProject,
} from "@/lib/db-helpers";

// Use them
const projects = await insertProject("My Project", "Description", userId);
```

### 3. Client-Side (Browser)

For client-side operations, continue using the Supabase SDK:

```typescript
import { supabase } from "@/lib/supabase";

const { data, error } = await supabase.from("users").select("*");
```

## Connection Pooling Benefits

The **pooler connection string** (`aws-1-ap-southeast-1.pooler.supabase.com`) uses pgBouncer for:

- ✅ Connection reuse (lower overhead)
- ✅ Better performance under high load
- ✅ Lower database connection limits
- ✅ Automatic connection cleanup

**vs** Direct connection (slower for many concurrent requests)

## Security Notes

- ✅ Connection string is in `.env` (git-ignored)
- ✅ Use parameterized queries (`$1, $2`, etc.) to prevent SQL injection
- ✅ Never hardcode credentials
- ✅ Use `SUPABASE_PERSONAL_ACCESS_TOKEN` for admin operations only

## Example: Creating an API Route

If using Vite with a backend setup:

```typescript
// src/api/projects.ts
import express from "express";
import { insertProject, getAllProjects } from "@/lib/db-helpers";

const router = express.Router();

router.post("/projects", async (req, res) => {
  try {
    const project = await insertProject(
      req.body.name,
      req.body.description,
      req.user.id
    );
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
```

## Testing the Connection

To verify your database connection works:

```typescript
import { queryOne } from "@/lib/db";

// Test query
const result = await queryOne("SELECT NOW() as time");
console.log("Database connected at:", result?.time);
```

## Troubleshooting

| Issue | Solution |
| --- | --- |
| `Connection refused` | Verify `SUPABASE_POOLER_CONNECTION_STRING` in `.env` |
| `Authentication failed` | Check `SUPABASE_DB_PASS` is correct |
| `Too many connections` | The pooler helps, but check for connection leaks |
| `Connection timeout` | Network issue or database is down |

## Next Steps

1. Update `db-helpers.ts` with your actual table names
2. Create API routes that use these database functions
3. Test with a simple query (see "Testing the Connection" above)
