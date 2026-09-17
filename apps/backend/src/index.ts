import { eq } from "drizzle-orm";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";
import { createDb, createSql, type Env } from "./db/client";
import { notes, projectScreenshots, projects, tasks, timelineEvents } from "./db/schema";

type Bindings = Env;
type AppContext = Context<{ Bindings: Bindings }>;
type Session = { id: string; login: string; email: string | null; name: string | null };
type NeonSessionResponse = { session?: { token?: string }; user?: { id?: string; name?: string; email?: string; role?: string } };
type NeonAuthResponse = NeonSessionResponse & { data?: NeonSessionResponse };
type RateLimiter = "AUTH_RATE_LIMIT" | "USER_RATE_LIMIT" | "UPLOAD_RATE_LIMIT";

const app = new Hono<{ Bindings: Bindings }>();
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
// Timeline attachments are stored as data URLs by the web client. Base64 expands
// the source file by about one third, plus a small URL header.
const MAX_TIMELINE_IMAGE_LENGTH = Math.ceil(MAX_UPLOAD_BYTES * 4 / 3) + 1_024;
const userIdSchema = z.string().trim().min(1).max(128);
const idSchema = z.string().uuid();
const timestampSchema = z.string().datetime({ offset: true });
const taskSchema = z.object({ id: idSchema, title: z.string().trim().min(1).max(200), status: z.enum(["backlog", "in-progress", "completed"]), createdAt: timestampSchema, description: z.string().max(10_000).optional(), reference: z.string().max(2_048).optional(), order: z.number().int().min(0).max(10_000).optional() }).strict();
const projectSchema = z.object({ id: idSchema, name: z.string().trim().min(1).max(200), description: z.string().max(10_000).optional(), tasks: z.array(taskSchema).max(200), createdAt: timestampSchema, updatedAt: timestampSchema }).strict();
const noteSchema = z.object({ id: idSchema, title: z.string().max(200).optional(), content: z.string().min(1).max(100_000), createdAt: timestampSchema, updatedAt: timestampSchema }).strict();
const timelineSchema = z.object({ id: idSchema, type: z.enum(["project", "task", "log", "screenshot", "custom"]), title: z.string().trim().min(1).max(200), description: z.string().max(10_000), image: z.string().max(MAX_TIMELINE_IMAGE_LENGTH).optional(), projectId: idSchema.optional(), projectName: z.string().max(200).optional(), timestamp: timestampSchema }).strict();
const stateSchema = z.object({ userId: userIdSchema, scope: z.enum(["projects", "notes", "timeline"]).optional(), projects: z.array(projectSchema).max(100), notes: z.array(noteSchema).max(500), timeline: z.array(timelineSchema).max(2_000) }).strict();
const allowedImageTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

class AppError extends Error {
  constructor(public readonly status: 400 | 401 | 404 | 413 | 415 | 429 | 503, public readonly publicMessage: string) { super(publicMessage); }
}

function failValidation(): never { throw new AppError(400, "Invalid request"); }
function requestId(c: AppContext) { return c.req.header("cf-ray") || crypto.randomUUID(); }
function errorResponse(c: AppContext, status: number, message: string, id = requestId(c)) {
  c.header("X-Request-ID", id); c.header("Cache-Control", "no-store");
  return c.json({ status: "error", data: null, error: message, requestId: id }, status as 400 | 401 | 404 | 413 | 415 | 429 | 500 | 503);
}

app.use("/*", (c, next) => cors({ origin: (origin) => isAllowedOrigin(origin, c.env) ? origin : undefined, credentials: true })(c, next));
app.use("/*", async (c, next) => { c.header("X-Request-ID", requestId(c)); await next(); });
app.onError((error, c) => {
  const id = requestId(c);
  if (error instanceof AppError) return errorResponse(c, error.status, error.publicMessage, id);
  console.error(JSON.stringify({ event: "request_failed", requestId: id, path: new URL(c.req.url).pathname, error: error instanceof Error ? error.name : "UnknownError" }));
  return errorResponse(c, 500, "An unexpected error occurred", id);
});

function sessionData(response: NeonAuthResponse): NeonSessionResponse { return response.data ?? response; }
function allowSession(user?: NeonSessionResponse["user"]): Session | null { return !user?.id || user.role !== "admin" ? null : { id: user.id, login: user.email || user.id, email: user.email || null, name: user.name || null }; }
async function neonAuthFetch(env: Env, path: string, cookie?: string | null, init: RequestInit = {}) { const headers = new Headers(init.headers); if (cookie) headers.set("Cookie", cookie); return fetch(`${env.NEON_AUTH_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, { ...init, headers }); }
async function readSession(request: Request, env: Env): Promise<Session | null> { try { const response = await neonAuthFetch(env, "/get-session", request.headers.get("Cookie")); return response.ok ? allowSession(sessionData(await response.json() as NeonAuthResponse).user) : null; } catch { return null; } }
async function requireSession(c: AppContext) { const session = await readSession(c.req.raw, c.env); if (!session) throw new AppError(401, "Unauthorized"); return session; }
function allowedOrigins(env: Env) { return env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean); }
function isAllowedOrigin(origin: string, env: Env) { if (allowedOrigins(env).includes(origin)) return true; try { const url = new URL(origin); return url.protocol === "https:" && url.hostname.endsWith(".devlog-b09.pages.dev"); } catch { return false; } }
function safeReturnTo(value: string | undefined, env: Env) { const fallback = allowedOrigins(env)[0] || "http://localhost:8080"; try { const url = new URL(value || fallback); return allowedOrigins(env).includes(url.origin) ? url.toString() : fallback; } catch { return fallback; } }
function copyAuthCookies(source: Response, target: Headers) {
  const cookies = typeof source.headers.getSetCookie === "function" ? source.headers.getSetCookie() : [];
  // These cookies are issued by Neon but are deliberately relayed through our
  // API origin so the web app can use them. `Partitioned` is not consistently
  // supported by Safari in this redirect chain; Safari can then omit the cookie
  // from /auth/session after GitHub returns. The cookie remains host-only,
  // Secure, HttpOnly, and SameSite=None without that attribute.
  for (const cookie of cookies) target.append("Set-Cookie", cookie.replace(/;\s*Partitioned\b/gi, ""));
}
async function restoreScreenshotsFromStorage(env: Env, userId: string) {
  const db = createDb(env);
  const [existingRows, userProjects] = await Promise.all([
    db.select().from(projectScreenshots).where(eq(projectScreenshots.userId, userId)),
    db.select({ id: projects.id }).from(projects).where(eq(projects.userId, userId)),
  ]);
  const existingObjectKeys = new Set(existingRows.map((row) => row.objectKey));
  const projectIds = new Set(userProjects.map((project) => project.id));
  const recovered: Array<typeof projectScreenshots.$inferInsert> = [];
  let cursor: string | undefined;

  do {
    const page = await env.SCREENSHOTS.list({ prefix: `${userId}/`, cursor });
    for (const object of page.objects) {
      if (existingObjectKeys.has(object.key)) continue;
      const [objectUserId, projectId, screenshotId, ...rest] = object.key.split("/");
      if (rest.length || objectUserId !== userId || !projectIds.has(projectId) || !idSchema.safeParse(projectId).success || !idSchema.safeParse(screenshotId).success) continue;
      const metadata = await env.SCREENSHOTS.head(object.key);
      if (!metadata || metadata.customMetadata?.userId !== userId || metadata.customMetadata?.projectId !== projectId) continue;
      recovered.push({ id: screenshotId, userId, projectId, objectKey: object.key, caption: null, contentType: metadata.httpMetadata?.contentType || "application/octet-stream", createdAt: object.uploaded, updatedAt: object.uploaded });
    }
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);

  if (recovered.length) await db.insert(projectScreenshots).values(recovered).onConflictDoNothing();
}
function clientKey(c: AppContext) { return c.req.header("cf-connecting-ip") || c.req.header("cf-ray") || "unknown"; }
async function enforceRateLimit(c: AppContext, limiter: RateLimiter, key: string) {
  try { if ((await c.env[limiter].limit({ key })).success) return null; c.header("Retry-After", "60"); c.header("RateLimit-Policy", "fixed;w=60"); return errorResponse(c, 429, "Too many requests"); }
  catch { console.error(JSON.stringify({ event: "rate_limit_unavailable", limiter, path: new URL(c.req.url).pathname })); return errorResponse(c, 503, "Service temporarily unavailable"); }
}
async function parseJson(c: AppContext) { try { return await c.req.json(); } catch { return failValidation(); } }
function assertImageSignature(bytes: Uint8Array, contentType: string) {
  const png = bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  const jpeg = bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const webp = bytes.length >= 12 && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (!((contentType === "image/png" && png) || (contentType === "image/jpeg" && jpeg) || (contentType === "image/webp" && webp))) throw new AppError(415, "Unsupported image format");
}

app.get("/health", async (c) => { try { await createDb(c.env).execute("select 1"); return c.json({ status: "ok", data: { database: "connected" }, error: null }); } catch { return errorResponse(c, 503, "Database unavailable"); } });
app.get("/auth/github", async (c) => {
  const limited = await enforceRateLimit(c, "AUTH_RATE_LIMIT", `auth:${clientKey(c)}`); if (limited) return limited;
  const returnTo = safeReturnTo(c.req.query("returnTo"), c.env); const callbackUrl = new URL("/auth/callback", c.req.url); callbackUrl.searchParams.set("returnTo", returnTo);
  try { const response = await neonAuthFetch(c.env, "/sign-in/social", c.req.header("Cookie"), { method: "POST", headers: { "Content-Type": "application/json", Origin: new URL(returnTo).origin }, body: JSON.stringify({ provider: "github", callbackURL: callbackUrl.toString(), disableRedirect: true }) }); const body = await response.json() as { url?: string }; if (!response.ok || !body.url || !body.url.startsWith("https://")) return errorResponse(c, 503, "GitHub login is unavailable"); const headers = new Headers({ Location: body.url }); copyAuthCookies(response, headers); return new Response(null, { status: 302, headers }); } catch { return errorResponse(c, 503, "GitHub login is unavailable"); }
});
app.get("/auth/callback", async (c) => {
  const limited = await enforceRateLimit(c, "AUTH_RATE_LIMIT", `auth:${clientKey(c)}`); if (limited) return limited;
  const returnTo = safeReturnTo(c.req.query("returnTo"), c.env); const verifier = c.req.query("neon_auth_session_verifier"); if (!verifier || verifier.length > 4096) return c.redirect(`${returnTo}?authError=login-failed`, 302);
  try { const response = await neonAuthFetch(c.env, `/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`, c.req.header("Cookie")); const session = response.ok ? allowSession(sessionData(await response.clone().json() as NeonAuthResponse).user) : null; const destination = new URL(returnTo); if (!response.ok) destination.searchParams.set("authError", "login-failed"); else if (!session) { destination.pathname = "/login"; destination.search = "authError=not-authorized"; } const headers = new Headers({ Location: destination.toString() }); copyAuthCookies(response, headers); return new Response(null, { status: 302, headers }); } catch { return c.redirect(`${returnTo}?authError=login-failed`, 302); }
});
app.get("/auth/session", async (c) => { const session = await requireSession(c); return c.json({ status: "ok", data: { id: session.id, name: session.name || session.login, provider: "github", isGuest: false, createdAt: new Date().toISOString() }, error: null }); });
app.post("/auth/signout", async (c) => { const session = await requireSession(c); const limited = await enforceRateLimit(c, "USER_RATE_LIMIT", `user:${session.id}`); if (limited) return limited; const response = await neonAuthFetch(c.env, "/sign-out", c.req.header("Cookie"), { method: "POST" }); const headers = new Headers(); copyAuthCookies(response, headers); return new Response(null, { status: response.ok ? 204 : 401, headers }); });
app.get("/api/state", async (c) => {
  const userId = userIdSchema.safeParse(c.req.query("userId")); const scope = z.enum(["projects", "notes", "timeline"]).safeParse(c.req.query("scope") || "projects"); if (!userId.success || !scope.success) failValidation(); const session = await requireSession(c); if (session.id !== userId.data) throw new AppError(401, "Unauthorized"); const limited = await enforceRateLimit(c, "USER_RATE_LIMIT", `user:${session.id}`); if (limited) return limited;
  const db = createDb(c.env); const projectRows = scope.data === "projects" ? await db.select().from(projects).where(eq(projects.userId, session.id)) : []; const taskRows = scope.data === "projects" ? await db.select().from(tasks).where(eq(tasks.userId, session.id)) : []; const noteRows = scope.data === "notes" ? await db.select().from(notes).where(eq(notes.userId, session.id)) : []; const eventRows = scope.data === "timeline" ? await db.select().from(timelineEvents).where(eq(timelineEvents.userId, session.id)) : []; return c.json({ status: "ok", data: { projects: projectRows, tasks: taskRows, notes: noteRows, timeline: eventRows }, error: null });
});
app.put("/api/state", async (c) => {
  const session = await requireSession(c); const limited = await enforceRateLimit(c, "USER_RATE_LIMIT", `user:${session.id}`); if (limited) return limited; const parsed = stateSchema.safeParse(await parseJson(c)); if (!parsed.success) failValidation(); if (session.id !== parsed.data.userId) throw new AppError(401, "Unauthorized");
  const scope = parsed.data.scope || "projects"; const { projects: nextProjects, notes: nextNotes, timeline: nextTimeline } = parsed.data; const nextTasks = nextProjects.flatMap((project) => project.tasks.map((task) => ({ ...task, projectId: project.id })));
  await createSql(c.env).transaction((tx) => {
    if (scope === "projects") return [tx`delete from tasks where user_id = ${session.id}`, ...nextProjects.map((project) => tx`insert into projects (id, user_id, title, description, created_at, updated_at) values (${project.id}, ${session.id}, ${project.name}, ${project.description || null}, ${new Date(project.createdAt).toISOString()}, ${new Date(project.updatedAt).toISOString()}) on conflict (id) do update set title = excluded.title, description = excluded.description, updated_at = excluded.updated_at where projects.user_id = ${session.id}`), ...nextTasks.map((task) => tx`insert into tasks (id, user_id, project_id, title, status, details, resource_path, created_at) values (${task.id}, ${session.id}, ${task.projectId}, ${task.title}, ${task.status}, ${task.description || null}, ${task.reference || null}, ${new Date(task.createdAt).toISOString()})`)];
    if (scope === "notes") return [tx`delete from notes where user_id = ${session.id}`, ...nextNotes.map((note) => tx`insert into notes (id, user_id, title, content, created_at, updated_at) values (${note.id}, ${session.id}, ${note.title || null}, ${note.content}, ${new Date(note.createdAt).toISOString()}, ${new Date(note.updatedAt).toISOString()})`)];
    return [tx`delete from timeline_events where user_id = ${session.id}`, ...nextTimeline.map((event) => tx`insert into timeline_events (id, user_id, project_id, event_type, payload, occurred_at) values (${event.id}, ${session.id}, ${event.projectId || null}, ${event.type}, ${JSON.stringify({ title: event.title, description: event.description, image: event.image, projectName: event.projectName })}::jsonb, ${new Date(event.timestamp).toISOString()})`)];
  });
  return c.json({ status: "ok", data: null, error: null });
});
app.get("/api/screenshots", async (c) => {
  const userId = userIdSchema.safeParse(c.req.query("userId")); const projectId = c.req.query("projectId"); if (!userId.success || (projectId && !idSchema.safeParse(projectId).success)) failValidation(); const session = await requireSession(c); if (session.id !== userId.data) throw new AppError(401, "Unauthorized"); const limited = await enforceRateLimit(c, "USER_RATE_LIMIT", `user:${session.id}`); if (limited) return limited;
  await restoreScreenshotsFromStorage(c.env, session.id);
  const rows = await createDb(c.env).select().from(projectScreenshots).where(eq(projectScreenshots.userId, session.id)); return c.json({ status: "ok", data: rows.filter((row) => !projectId || row.projectId === projectId).map((row) => ({ id: row.id, user_id: row.userId, project_id: row.projectId, file_path: `/api/assets/${encodeURIComponent(row.objectKey)}`, caption: row.caption, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString() })), error: null });
});
app.post("/api/screenshots", async (c) => {
  const declaredLength = Number(c.req.header("content-length")); if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES + 32_768) throw new AppError(413, "Image is too large"); const session = await requireSession(c); const limited = await enforceRateLimit(c, "UPLOAD_RATE_LIMIT", `upload:${session.id}`); if (limited) return limited; let form: FormData; try { form = await c.req.formData(); } catch { return failValidation(); }
  const userId = userIdSchema.safeParse(form.get("userId")); const projectId = idSchema.safeParse(form.get("projectId")); const caption = z.string().max(500).safeParse(form.get("caption") ?? ""); const file = form.get("file"); if (!userId.success || !projectId.success || !caption.success || !(file instanceof File)) failValidation(); if (file.size > MAX_UPLOAD_BYTES) throw new AppError(413, "Image is too large"); if (!allowedImageTypes.has(file.type)) throw new AppError(415, "Unsupported image format"); if (session.id !== userId.data) throw new AppError(401, "Unauthorized"); const bytes = new Uint8Array(await file.arrayBuffer()); assertImageSignature(bytes, file.type);
  const id = crypto.randomUUID(); const objectKey = `${session.id}/${projectId.data}/${id}`; const now = new Date(); await c.env.SCREENSHOTS.put(objectKey, bytes, { httpMetadata: { contentType: file.type, contentDisposition: "inline" }, customMetadata: { userId: session.id, projectId: projectId.data } }); await createDb(c.env).insert(projectScreenshots).values({ id, userId: session.id, projectId: projectId.data, objectKey, caption: caption.data || null, contentType: file.type, createdAt: now, updatedAt: now }); return c.json({ status: "ok", data: { id, user_id: session.id, project_id: projectId.data, file_path: `/api/assets/${encodeURIComponent(objectKey)}`, caption: caption.data || undefined, created_at: now.toISOString(), updated_at: now.toISOString() }, error: null }, 201);
});
app.get("/api/assets/:key{.+}", async (c) => { const session = await requireSession(c); const limited = await enforceRateLimit(c, "USER_RATE_LIMIT", `user:${session.id}`); if (limited) return limited; const object = await c.env.SCREENSHOTS.get(c.req.param("key")); if (!object || object.customMetadata?.userId !== session.id) throw new AppError(404, "Not found"); return new Response(object.body, { headers: { "Content-Type": object.httpMetadata?.contentType || "application/octet-stream", "Content-Disposition": "inline", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } }); });
app.notFound((c) => errorResponse(c, 404, "Not found"));
export default app;
