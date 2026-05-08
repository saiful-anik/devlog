/**
 * Database helper functions
 * Example usage patterns for querying and writing to the database
 */

import { query, queryRows, queryOne } from "./db";

/**
 * Example: Get all users
 */
export async function getAllUsers() {
  return queryRows("SELECT * FROM auth.users");
}

/**
 * Example: Get a user by ID
 */
export async function getUserById(userId: string) {
  return queryOne("SELECT * FROM auth.users WHERE id = $1", [userId]);
}

/**
 * Example: Insert a new record
 */
export async function insertProject(
  name: string,
  description: string,
  userId: string
) {
  return queryOne(
    `INSERT INTO projects (name, description, user_id, created_at)
     VALUES ($1, $2, $3, NOW())
     RETURNING *`,
    [name, description, userId]
  );
}

/**
 * Example: Update a record
 */
export async function updateProject(
  projectId: string,
  updates: Record<string, any>
) {
  const columns = Object.keys(updates);
  const values = Object.values(updates);

  const setClause = columns.map((col, i) => `${col} = $${i + 1}`).join(", ");
  const query_text = `UPDATE projects SET ${setClause} WHERE id = $${columns.length + 1} RETURNING *`;

  return queryOne(query_text, [...values, projectId]);
}

/**
 * Example: Delete a record
 */
export async function deleteProject(projectId: string) {
  return query("DELETE FROM projects WHERE id = $1", [projectId]);
}

/**
 * Example: Execute raw SQL query
 * Use with caution - always use parameterized queries to prevent SQL injection
 */
export async function executeQuery(sql: string, params?: any[]) {
  return query(sql, params);
}
