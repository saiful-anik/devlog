import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { createDb, type Env } from "./db/client";
import { notes, projectScreenshots, projects, tasks, timelineEvents } from "./db/schema";

type Bindings = Env;
const app = new Hono<{ Bindings: Bindings }>();

app.use("/*", (c, next) => {
  const requestedOrigin = c.req.header("Origin");
  const allowedOrigins = c.env.CORS_ORIGIN.split(",").map((origin) => origin.trim());
  const origin = requestedOrigin && allowedOrigins.includes(requestedOrigin) ? requestedOrigin : allowedOrigins[0];
  return cors({ origin, credentials: true })(c, next);
});

type Session = { id: string; login: string; email: string | null; name: string | null };
type NeonSessionResponse = { session?: { token?: string }; user?: { id?: string; name?: string; email?: string; role?: string; createdAt?: string } };

async function sessionFromToken(token: string, env: Env): Promise<Session | null> {
  if (!/^[A-Za-z0-9._-]{20,8192}$/.test(token)) return null;
  try {
    const jwks = createRemoteJWKSet(new URL(env.NEON_AUTH_JWKS_URL));
    const { payload } = await jwtVerify(token, jwks, { algorithms: ["EdDSA"] });
    if (typeof payload.sub !== "string" || !payload.sub) return null;
    const session = {
      id: payload.sub,
      login: typeof payload.preferred_username === "string" ? payload.preferred_username : typeof payload.email === "string" ? payload.email : payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
    };
    return session;
  } catch { return null; }
}

function allowSession(session: Session, neonUser?: NeonSessionResponse["user"]) {
  if (neonUser?.role !== "admin") return null;
  if (typeof neonUser.email === "string") session.email = neonUser.email;
  if (typeof neonUser.name === "string") session.name = neonUser.name;
  return session;
}

async function readSession(request: Request, env: Env): Promise<Session | null> {
  let token = request.headers.get("Authorization")?.match(/^Bearer ([A-Za-z0-9._-]{20,8192})$/)?.[1];
  if (!token) {
    try {
      const response = await neonAuthFetch(env, "/get-session", request.headers.get("Cookie"));
      if (!response.ok) {
        console.log("Neon Auth session unavailable", JSON.stringify({ status: response.status }));
        return null;
      }
      const result = await response.json() as NeonSessionResponse;
      console.log("Neon Auth session", JSON.stringify({
        hasToken: Boolean(result.session?.token),
        jwtSubject: result.session?.token ? "present" : "missing",
        user: result.user ? { id: result.user.id, email: result.user.email, role: result.user.role, name: result.user.name } : null,
      }));
      if (!result.session?.token) return null;
      const session = await sessionFromToken(result.session.token, env);
      console.log("Neon Auth authorization", JSON.stringify({ tokenSubject: session?.id ?? null, userId: result.user?.id ?? null, role: result.user?.role ?? null, allowed: Boolean(session && allowSession({ ...session }, result.user)) }));
      return session ? allowSession(session, result.user) : null;
    } catch (error) {
      console.log("Neon Auth session error", error instanceof Error ? error.message : "unknown error");
      return null;
    }
  }
  const session = await sessionFromToken(token, env);
  return null;
}

function allowedOrigins(env: Env) {
  return env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean);
}

function safeReturnTo(value: string | null | undefined, env: Env) {
  const fallback = allowedOrigins(env)[0] || "http://localhost:8080";
  try {
    const url = new URL(value || fallback);
    return allowedOrigins(env).includes(url.origin) ? url.toString() : fallback;
  } catch { return fallback; }
}

async function neonAuthFetch(env: Env, path: string, cookie?: string | null | undefined, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  if (cookie) headers.set("Cookie", cookie);
  return fetch(`${env.NEON_AUTH_URL.replace(/\/$/, "")}/${path.replace(/^\//, "")}`, { ...init, headers });
}

function copyAuthCookies(source: Response, target: Headers) {
  const cookies = typeof source.headers.getSetCookie === "function" ? source.headers.getSetCookie() : [];
  for (const cookie of cookies) target.append("Set-Cookie", cookie);
}

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

app.get("/auth/github", async (c) => {
  const returnTo = safeReturnTo(c.req.query("returnTo"), c.env);
  const callbackUrl = new URL("/auth/callback", c.req.url);
  callbackUrl.searchParams.set("returnTo", returnTo);
  try {
    const response = await neonAuthFetch(c.env, "/sign-in/social", c.req.header("Cookie"), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: new URL(returnTo).origin },
      body: JSON.stringify({ provider: "github", callbackURL: callbackUrl.toString(), disableRedirect: true }),
    });
    const body = await response.json() as { url?: string };
    if (!response.ok || !body.url || !body.url.startsWith("https://")) return c.json({ status: "error", data: null, error: "GitHub login is unavailable" }, 503);
    const headers = new Headers({ Location: body.url });
    copyAuthCookies(response, headers);
    return new Response(null, { status: 302, headers });
  } catch { return c.json({ status: "error", data: null, error: "GitHub login is unavailable" }, 503); }
});

app.get("/auth/callback", async (c) => {
  const returnTo = safeReturnTo(c.req.query("returnTo"), c.env);
  const verifier = c.req.query("neon_auth_session_verifier");
  if (!verifier || verifier.length > 4096) return c.redirect(`${returnTo}?authError=login-failed`, 302);
  const sessionPath = `/get-session?neon_auth_session_verifier=${encodeURIComponent(verifier)}`;
  try {
    const response = await neonAuthFetch(c.env, sessionPath, c.req.header("Cookie"));
    const result = response.ok ? await response.clone().json() as NeonSessionResponse : null;
    const verifiedSession = result?.session?.token ? await sessionFromToken(result.session.token, c.env) : null;
    const session = verifiedSession ? allowSession(verifiedSession, result?.user) : null;
    const destination = new URL(returnTo);
    if (!response.ok) destination.searchParams.set("authError", "login-failed");
    else if (!session) {
      destination.pathname = "/login";
      destination.search = "authError=not-authorized";
    }
    const headers = new Headers({ Location: destination.toString() });
    copyAuthCookies(response, headers);
    return new Response(null, { status: 302, headers });
  } catch { return c.redirect(`${returnTo}?authError=login-failed`, 302); }
});

app.get("/auth/session", async (c) => {
  const session = await readSession(c.req.raw, c.env);
  if (!session) return c.json({ status: "error", data: null, error: "You do not have permission to use this app" }, 403);
  return c.json({ status: "ok", data: { id: session.id, name: session.name || session.login, provider: "github", isGuest: false, createdAt: new Date().toISOString() }, error: null });
});

app.post("/auth/signout", async (c) => {
  const response = await neonAuthFetch(c.env, "/sign-out", c.req.header("Cookie"), { method: "POST" });
  const headers = new Headers();
  copyAuthCookies(response, headers);
  return new Response(null, { status: response.ok ? 204 : 401, headers });
});

app.get("/api/state", async (c) => {
  try {
    const userId = requireUserId(c.req.query("userId"));
    const session = await readSession(c.req.raw, c.env);
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
    const session = await readSession(c.req.raw, c.env);
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
  const session = await readSession(c.req.raw, c.env);
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
    const session = await readSession(c.req.raw, c.env);
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
