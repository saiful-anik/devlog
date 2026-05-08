/**
 * Database helpers for project screenshots
 * Direct database access using the pooler connection
 */

import { query, queryRows, queryOne } from "./db";

export interface ProjectScreenshot {
  id: string;
  user_id: string;
  project_id: string;
  file_path: string;
  caption?: string;
  created_at: string;
  updated_at: string;
}

/**
 * Get all screenshots for a project
 */
export async function getProjectScreenshots(
  projectId: string
): Promise<ProjectScreenshot[]> {
  return queryRows<ProjectScreenshot>(
    "SELECT * FROM project_screenshots WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId]
  );
}

/**
 * Insert a new project screenshot
 */
export async function insertProjectScreenshot(
  userId: string,
  projectId: string,
  filePath: string,
  caption?: string
): Promise<ProjectScreenshot> {
  const result = await queryOne<ProjectScreenshot>(
    `INSERT INTO project_screenshots (user_id, project_id, file_path, caption, created_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW(), NOW())
     RETURNING *`,
    [userId, projectId, filePath, caption || null]
  );

  if (!result) {
    throw new Error("Failed to insert project screenshot");
  }

  return result;
}

/**
 * Update a project screenshot
 */
export async function updateProjectScreenshot(
  screenshotId: string,
  caption?: string
): Promise<ProjectScreenshot> {
  const result = await queryOne<ProjectScreenshot>(
    `UPDATE project_screenshots 
     SET caption = $1, updated_at = NOW()
     WHERE id = $2
     RETURNING *`,
    [caption || null, screenshotId]
  );

  if (!result) {
    throw new Error("Failed to update project screenshot");
  }

  return result;
}

/**
 * Delete a project screenshot
 */
export async function deleteProjectScreenshot(screenshotId: string): Promise<void> {
  await query("DELETE FROM project_screenshots WHERE id = $1", [
    screenshotId,
  ]);
}
