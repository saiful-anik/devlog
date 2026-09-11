import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createDb, type Env } from "./db/client";
import { notes, projectScreenshots, projects, tasks, timelineEvents } from "./db/schema";

type Bindings = Env;
const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", (c, next) => cors({ origin: c.env.CORS_ORIGIN, credentials: true })(c, next));

type Session = { id: string; login: string; email: string | null; name: string | null };
const encoder = new TextEncoder();
const toBase64Url = (value: string) => btoa(value).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
const fromBase64Url = (value: string) => atob(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="));
const cookie = (name: string, value: string, maxAge?: number) => `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Secure${maxAge ? `; Max-Age=${maxAge}` : ""}`;

async function sign(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(String.fromCharCode(...new Uint8Array(bytes)));
}

async function createSession(session: Session, secret: string) {
  const payload = toBase64Url(JSON.stringify({ ...session, exp: Date.now() + 7 * 24 * 60 * 60 * 1000 }));
  return `${payload}.${await sign(payload, secret)}`;
}

async function readSession(request: Request, secret: string): Promise<Session | null> {
  const token = request.headers.get("Cookie")?.match(/(?:^|; )devlog_session=([^;]+)/)?.[1];
  if (!token) return null;
  const [payload, signature] = token.split(".");
  if (!payload || !signature || signature !== await sign(payload, secret)) return null;
  try {
    const session = JSON.parse(fromBase64Url(payload));
    return session.exp > Date.now() ? session : null;
  } catch { return null; }
}

function isAllowed(session: Session, allowedUsers: string) {
  const allowed = allowedUsers.split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(session.login.toLowerCase()) || Boolean(session.email && allowed.includes(session.email.toLowerCase()));
}

app.get("/auth/session", async (c) => {
  const session = await readSession(c.req.raw, c.env.SESSION_SECRET);
  return c.json({ status: "ok", data: session, error: null });
});

app.get("/auth/github", (c) => {
  if (!c.env.GITHUB_CLIENT_ID) return c.json({ status: "error", data: null, error: "GitHub OAuth is not configured" }, 503);
  const state = crypto.randomUUID();
  const requestedNext = c.req.query("next");
  const next = requestedNext?.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const callback = new URL("/auth/github/callback", c.req.url).toString();
  const url = new URL("https://github.com/login/oauth/authorize");
  url.search = new URLSearchParams({ client_id: c.env.GITHUB_CLIENT_ID, redirect_uri: callback, scope: "read:user user:email", state: `${state}:${next}` }).toString();
  c.header("Set-Cookie", cookie("devlog_oauth_state", state, 600));
  return c.redirect(url.toString());
});

app.get("/auth/github/callback", async (c) => {
  const state = c.req.query("state") || "";
  const [nonce, requestedNext = "/"] = state.split(":", 2);
  const next = requestedNext.startsWith("/") && !requestedNext.startsWith("//") ? requestedNext : "/";
  const stateCookie = c.req.header("Cookie")?.match(/(?:^|; )devlog_oauth_state=([^;]+)/)?.[1];
  if (!nonce || nonce !== stateCookie) return c.text("Invalid GitHub sign-in state.", 400);
  const code = c.req.query("code");
  if (!code) return c.text("GitHub did not return an authorization code.", 400);
  const callback = new URL("/auth/github/callback", c.req.url).toString();
  const tokenResponse = await fetch("https://github.com/login/oauth/access_token", { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify({ client_id: c.env.GITHUB_CLIENT_ID, client_secret: c.env.GITHUB_CLIENT_SECRET, code, redirect_uri: callback }) });
  const token = await tokenResponse.json<{ access_token?: string }>();
  if (!token.access_token) return c.text("GitHub authorization failed.", 401);
  const headers = { Authorization: `Bearer ${token.access_token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  const [profileResponse, emailsResponse] = await Promise.all([fetch("https://api.github.com/user", { headers }), fetch("https://api.github.com/user/emails", { headers })]);
  if (!profileResponse.ok) return c.text("Unable to load your GitHub profile.", 401);
  const profile = await profileResponse.json<{ id: number; login: string; name: string | null; email: string | null }>();
  const emails = emailsResponse.ok ? await emailsResponse.json<Array<{ email: string; primary: boolean; verified: boolean }>>() : [];
  const email = profile.email || emails.find((item) => item.primary && item.verified)?.email || emails.find((item) => item.verified)?.email || null;
  const session = { id: String(profile.id), login: profile.login, email, name: profile.name };
  if (!isAllowed(session, c.env.ALLOWED_USERS)) return c.text("You do not have permission to use this app.", 403);
  c.header("Set-Cookie", `${cookie("devlog_session", await createSession(session, c.env.SESSION_SECRET), 604800)}, ${cookie("devlog_oauth_state", "", 0)}`);
  return c.redirect(new URL(next, c.req.url).toString());
});

app.post("/auth/logout", (c) => { c.header("Set-Cookie", cookie("devlog_session", "", 0)); return c.json({ status: "ok", data: null, error: null }); });

const requireUserId = (value: string | undefined) => {
  if (!value || value.length > 128) throw new Error("A valid user id is required");
  return value;
};

app.get("/health", async (c) => {
  try {
    await createDb(c.env).execute("select 1");
    return c.json({ status: "ok", data: { database: "connected" }, error: null });
  } catch {
    return c.json({ status: "error", data: null, error: "Database unavailable" }, 503);
  }
});

app.get("/api/state", async (c) => {
  try {
    const userId = requireUserId(c.req.query("userId"));
    const session = await readSession(c.req.raw, c.env.SESSION_SECRET);
    if (!session || session.id !== userId) return c.json({ status: "error", data: null, error: "Unauthorized" }, 401);
    const db = createDb(c.env);
    const [projectRows, taskRows, noteRows, eventRows] = await Promise.all([
      db.select().from(projects).where(eq(projects.userId, userId)),
      db.select().from(tasks).where(eq(tasks.userId, userId)),
      db.select().from(notes).where(eq(notes.userId, userId)),
      db.select().from(timelineEvents).where(eq(timelineEvents.userId, userId)),
    ]);
    return c.json({ status: "ok", data: { projects: projectRows, tasks: taskRows, notes: noteRows, timeline: eventRows }, error: null });
  } catch (error) {
    return c.json({ status: "error", data: null, error: error instanceof Error ? error.message : "Unable to load data" }, 400);
  }
});

app.put("/api/state", async (c) => {
  try {
    const body = await c.req.json();
    const userId = requireUserId(body.userId);
    const session = await readSession(c.req.raw, c.env.SESSION_SECRET);
    if (!session || session.id !== userId) return c.json({ status: "error", data: null, error: "Unauthorized" }, 401);
    const db = createDb(c.env);
    const nextProjects = Array.isArray(body.projects) ? body.projects : [];
    const nextNotes = Array.isArray(body.notes) ? body.notes : [];
    const nextTimeline = Array.isArray(body.timeline) ? body.timeline : [];
    const nextTasks = nextProjects.flatMap((project: { id: string; tasks?: unknown[] }) =>
      (Array.isArray(project.tasks) ? project.tasks : []).map((task) => ({ ...(task as Record<string, unknown>), projectId: project.id })),
    );

    await db.transaction(async (tx) => {
      await tx.delete(tasks).where(eq(tasks.userId, userId));
      await tx.delete(timelineEvents).where(eq(timelineEvents.userId, userId));
      await tx.delete(notes).where(eq(notes.userId, userId));
      await tx.delete(projects).where(eq(projects.userId, userId));

      if (nextProjects.length) await tx.insert(projects).values(nextProjects.map((project: Record<string, unknown>) => ({ id: project.id as string, userId, title: project.name as string, description: (project.description as string) || null, createdAt: new Date(project.createdAt as string), updatedAt: new Date(project.updatedAt as string) })));
      if (nextTasks.length) await tx.insert(tasks).values(nextTasks.map((task: Record<string, unknown>) => ({ id: task.id as string, userId, projectId: task.projectId as string, title: task.title as string, status: task.status as string, details: (task.description as string) || null, resourcePath: (task.reference as string) || null, createdAt: new Date(task.createdAt as string) })));
      if (nextNotes.length) await tx.insert(notes).values(nextNotes.map((note: Record<string, unknown>) => ({ id: note.id as string, userId, title: (note.title as string) || null, content: note.content as string, createdAt: new Date(note.createdAt as string), updatedAt: new Date(note.updatedAt as string) })));
      if (nextTimeline.length) await tx.insert(timelineEvents).values(nextTimeline.map((event: Record<string, unknown>) => ({ id: event.id as string, userId, projectId: (event.projectId as string) || null, eventType: event.type as string, payload: { title: event.title, description: event.description, image: event.image, projectName: event.projectName }, occurredAt: new Date(event.timestamp as string) })));
    });
    return c.json({ status: "ok", data: null, error: null });
  } catch (error) {
    return c.json({ status: "error", data: null, error: error instanceof Error ? error.message : "Unable to save data" }, 400);
  }
});

app.get("/api/screenshots", async (c) => {
  const userId = requireUserId(c.req.query("userId"));
  const session = await readSession(c.req.raw, c.env.SESSION_SECRET);
  if (!session || session.id !== userId) return c.json({ status: "error", data: null, error: "Unauthorized" }, 401);
  const projectId = c.req.query("projectId");
  const db = createDb(c.env);
  const rows = await db.select().from(projectScreenshots).where(eq(projectScreenshots.userId, userId));
  return c.json({ status: "ok", data: rows.filter((row) => !projectId || row.projectId === projectId).map((row) => ({ id: row.id, user_id: row.userId, project_id: row.projectId, file_path: `/api/assets/${encodeURIComponent(row.objectKey)}`, caption: row.caption, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() })), error: null });
});

app.post("/api/screenshots", async (c) => {
  try {
    const form = await c.req.formData();
    const userId = requireUserId(String(form.get("userId") || ""));
    const session = await readSession(c.req.raw, c.env.SESSION_SECRET);
    if (!session || session.id !== userId) return c.json({ status: "error", data: null, error: "Unauthorized" }, 401);
    const projectId = String(form.get("projectId") || "");
    const file = form.get("file");
    if (!projectId || !(file instanceof File) || !file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) throw new Error("A PNG, JPEG, WebP, or GIF image up to 5 MB is required");
    const id = crypto.randomUUID();
    const objectKey = `${userId}/${projectId}/${id}`;
    await c.env.SCREENSHOTS.put(objectKey, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { userId, projectId } });
    const now = new Date();
    await createDb(c.env).insert(projectScreenshots).values({ id, userId, projectId, objectKey, caption: String(form.get("caption") || "") || null, contentType: file.type, createdAt: now, updatedAt: now });
    return c.json({ status: "ok", data: { id, user_id: userId, project_id: projectId, file_path: `/api/assets/${encodeURIComponent(objectKey)}`, caption: String(form.get("caption") || "") || undefined, created_at: now.toISOString(), updated_at: now.toISOString() }, error: null }, 201);
  } catch (error) {
    return c.json({ status: "error", data: null, error: error instanceof Error ? error.message : "Upload failed" }, 400);
  }
});

app.get("/api/assets/:key{.+}", async (c) => {
  const object = await c.env.SCREENSHOTS.get(c.req.param("key"));
  if (!object) return c.notFound();
  return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" } });
});

app.notFound((c) => c.json({ status: "error", data: null, error: "Not found" }, 404));
export default app;
