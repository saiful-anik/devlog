import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const PROJECT_SCREENSHOT_BUCKET = "project-screenshot";
const TASK_SCREENSHOT_BUCKET = "task-screenshot";

export interface Task {
  id: string;
  title: string;
  status: "backlog" | "in-progress" | "completed";
  createdAt: string;
  description?: string;
  screenshots?: string[];
  order?: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  tasks: Task[];
  screenshots: string[]; // base64 data URLs
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: string;
  title: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

export interface TimelineEvent {
  id: string;
  type: "project" | "task" | "log" | "custom";
  title: string;
  description: string;
  image?: string;
  projectId?: string;
  projectName?: string;
  timestamp: string;
}

export type StoreScope = "projects" | "notes" | "timeline";

type StoreListener = (scope: StoreScope) => void;

const listeners = new Set<StoreListener>();

let cachedProjects: Project[] = [];
let cachedNotes: Note[] = [];
let cachedTimeline: TimelineEvent[] = [];

let realtimeChannel: RealtimeChannel | null = null;
let realtimeUserId: string | null = null;
let realtimeSetupPromise: Promise<void> | null = null;

function cloneProjects(projects: Project[]) {
  return projects.map((project) => ({
    ...project,
    tasks: project.tasks.map((task) => ({
      ...task,
      screenshots: [...(task.screenshots ?? [])],
    })),
    screenshots: [...project.screenshots],
  }));
}

function cloneNotes(notes: Note[]) {
  return notes.map((note) => ({ ...note }));
}

function cloneTimeline(timeline: TimelineEvent[]) {
  return timeline.map((event) => ({ ...event }));
}

function isDataUrl(value: string) {
  return value.startsWith("data:");
}

function parseStoredImageRef(value: string): { bucket: string; objectPath: string } | null {
  if (!value || isDataUrl(value) || value.startsWith("http")) return null;
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0) return null;

  const bucket = value.slice(0, slashIndex);
  const objectPath = value.slice(slashIndex + 1);
  if (!bucket || !objectPath) return null;

  return { bucket, objectPath };
}

function dataUrlToBlob(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  if (!meta || !base64) throw new Error("Invalid image data URL.");

  const mimeMatch = /data:([^;]+);base64/.exec(meta);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
}

async function uploadImageToStorage(userId: string, bucket: string, imageDataUrl: string) {
  if (!supabase) throw new Error("Supabase unavailable");
  const { blob, mimeType } = dataUrlToBlob(imageDataUrl);
  const ext = mimeType.split("/")[1] || "bin";
  const objectPath = `${userId}/${crypto.randomUUID()}.${ext}`;

  const { error } = await supabase.storage
    .from(bucket)
    .upload(objectPath, blob, {
      upsert: false,
      contentType: mimeType,
    });

  if (error) throw error;
  return `${bucket}/${objectPath}`;
}

async function normalizeImageRef(userId: string, image: string, bucket: string) {
  if (isDataUrl(image)) {
    return uploadImageToStorage(userId, bucket, image);
  }

  if (image.startsWith("http")) {
    const marker = `/object/public/${bucket}/`;
    const markerIndex = image.indexOf(marker);
    if (markerIndex >= 0) {
      return `${bucket}/${image.slice(markerIndex + marker.length)}`;
    }

    return image;
  }

  return image;
}

export function resolveImageSrc(value?: string) {
  if (!value) return "";
  if (isDataUrl(value) || value.startsWith("http") || !supabase) return value;

  const ref = parseStoredImageRef(value);
  if (!ref) return value;

  const { data } = supabase.storage.from(ref.bucket).getPublicUrl(ref.objectPath);
  return data.publicUrl;
}

export function getCachedProjects(): Project[] {
  return cloneProjects(cachedProjects);
}

export function getCachedNotes(): Note[] {
  return cloneNotes(cachedNotes);
}

export function getCachedTimeline(): TimelineEvent[] {
  return cloneTimeline(cachedTimeline);
}

function setCachedProjects(projects: Project[]) {
  cachedProjects = cloneProjects(projects);
}

function setCachedNotes(notes: Note[]) {
  cachedNotes = cloneNotes(notes);
}

function setCachedTimeline(timeline: TimelineEvent[]) {
  cachedTimeline = cloneTimeline(timeline);
}

export function subscribeToStoreChanges(listener: StoreListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function notifyStoreChange(scope: StoreScope) {
  for (const listener of listeners) {
    listener(scope);
  }
}

let warnedFallback = false;
let lastFallbackReason: string | null = null;

function warnFallback(reason: string) {
  lastFallbackReason = reason;
  if (warnedFallback) return;
  warnedFallback = true;
  console.warn(`Supabase unavailable: ${reason}`);
}

async function stopRealtimeSync() {
  if (realtimeChannel && supabase) {
    await supabase.removeChannel(realtimeChannel);
  }

  realtimeChannel = null;
  realtimeUserId = null;
  realtimeSetupPromise = null;
}

async function refreshScopeFromRemote(scope: StoreScope, userId: string) {
  if (!supabase) return;

  if (scope === "projects") {
    const projects = await getProjectsRemote(userId);
    setCachedProjects(projects);
    notifyStoreChange("projects");
    return;
  }

  if (scope === "notes") {
    const notes = await getNotesRemote(userId);
    setCachedNotes(notes);
    notifyStoreChange("notes");
    return;
  }

  const timeline = await getTimelineRemote(userId);
  setCachedTimeline(timeline);
  notifyStoreChange("timeline");
}

async function ensureRealtimeSync(userId: string) {
  if (!supabase) return;
  if (realtimeChannel && realtimeUserId === userId) return;

  if (realtimeSetupPromise) {
    await realtimeSetupPromise;
    if (realtimeChannel && realtimeUserId === userId) return;
  }

  realtimeSetupPromise = (async () => {
    await stopRealtimeSync();
    realtimeUserId = userId;

    const channel = supabase.channel(`devlog-sync:${userId}`);
    realtimeChannel = channel;

    const attach = (table: string, scope: StoreScope) => {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `user_id=eq.${userId}`,
        },
        () => {
          void refreshScopeFromRemote(scope, userId).catch((error) => {
            warnFallback((error as Error).message);
          });
        },
      );
    };

    attach("projects", "projects");
    attach("tasks", "projects");
    attach("project_screenshots", "projects");
    attach("task_screenshots", "projects");
    attach("notes", "notes");
    attach("timeline_events", "timeline");

    await channel.subscribe();
  })();

  try {
    await realtimeSetupPromise;
  } finally {
    realtimeSetupPromise = null;
  }
}

async function getUserId(): Promise<string | null> {
  if (!supabase) {
    warnFallback("missing Supabase environment configuration");
    return null;
  }

  const {
    data: { session },
    error: sessionError,
  } = await supabase.auth.getSession();

  if (sessionError) {
    warnFallback(sessionError.message);
    return null;
  }

  if (session?.user?.id) {
    void ensureRealtimeSync(session.user.id);
    return session.user.id;
  }

  warnFallback("no authenticated GitHub session");
  return null;
}

export async function resetStoreSync() {
  await stopRealtimeSync();
  cachedProjects = [];
  cachedNotes = [];
  cachedTimeline = [];
}

type ProjectRow = {
  id: string;
  title: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type TaskRow = {
  id: string;
  project_id: string;
  title: string;
  status: Task["status"];
  created_at: string;
  details: string | null;
  due_date: string | null;
};

type ProjectScreenshotRow = {
  id: string;
  project_id: string;
  file_path: string;
  caption: string | null;
};

type TaskScreenshotRow = {
  id: string;
  task_id: string;
  file_path: string;
  caption: string | null;
};

type NoteRow = {
  id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type TimelineRow = {
  id: string;
  project_id: string;
  event_type: TimelineEvent["type"];
  payload: { title?: string; description?: string; image?: string; projectName?: string } | null;
  occurred_at: string;
};

function serializeNoteContent(note: Note) {
  return JSON.stringify({
    title: note.title,
    content: note.content,
  });
}

function deserializeNoteContent(rawContent: string) {
  try {
    const parsed = JSON.parse(rawContent) as { title?: string; content?: string };
    if (typeof parsed === "object" && parsed !== null && (parsed.title !== undefined || parsed.content !== undefined)) {
      return {
        title: parsed.title ?? "Untitled Note",
        content: parsed.content ?? "",
      };
    }
  } catch {
    // Keep backward compatibility for plain text content.
  }

  const fallbackTitle = rawContent.trim().split("\n")[0]?.slice(0, 40) || "Untitled Note";
  return {
    title: fallbackTitle,
    content: rawContent,
  };
}

async function resolveTimelineProjectId(
  userId: string,
  preferredProjectId?: string,
): Promise<string> {
  if (!supabase) throw new Error("Supabase unavailable");

  if (preferredProjectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("user_id", userId)
      .eq("id", preferredProjectId)
      .limit(1)
      .maybeSingle();

    if (error) throw error;
    if (data?.id) return data.id;
  }

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  if (!data?.id) {
    throw new Error("Create a project first before adding timeline events.");
  }

  return data.id;
}

async function getProjectsRemote(userId: string): Promise<Project[]> {
  if (!supabase) return [];

  const { data: projectsRows, error: projectsError } = await supabase
    .from("projects")
    .select("id, title, description, created_at, updated_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (projectsError) throw projectsError;

  const projectIds = (projectsRows ?? []).map((row) => row.id);

  const [tasksResult, projectScreenshotsResult, taskScreenshotsResult] =
    await Promise.all([
      projectIds.length
        ? supabase
            .from("tasks")
            .select("id, project_id, title, status, created_at, details, due_date")
            .eq("user_id", userId)
            .in("project_id", projectIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as TaskRow[], error: null }),
      projectIds.length
        ? supabase
            .from("project_screenshots")
            .select("id, project_id, file_path, caption")
            .eq("user_id", userId)
            .in("project_id", projectIds)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as ProjectScreenshotRow[], error: null }),
      projectIds.length
        ? supabase
            .from("task_screenshots")
            .select("id, task_id, file_path, caption")
            .eq("user_id", userId)
            .order("created_at", { ascending: true })
        : Promise.resolve({ data: [] as TaskScreenshotRow[], error: null }),
    ]);

  if (tasksResult.error) throw tasksResult.error;
  if (projectScreenshotsResult.error) throw projectScreenshotsResult.error;
  if (taskScreenshotsResult.error) throw taskScreenshotsResult.error;

  const tasksByProject = new Map<string, Task[]>();
  const taskScreenshotsByTask = new Map<string, string[]>();

  for (const row of taskScreenshotsResult.data ?? []) {
    const current = taskScreenshotsByTask.get(row.task_id) ?? [];
    current.push(row.file_path);
    taskScreenshotsByTask.set(row.task_id, current);
  }

  for (const row of tasksResult.data ?? []) {
    const list = tasksByProject.get(row.project_id) ?? [];
    const task: Task = {
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      description: row.details ?? "",
      order: list.length,
      screenshots: taskScreenshotsByTask.get(row.id) ?? [],
    };

    list.push(task);
    tasksByProject.set(row.project_id, list);
  }

  const projectScreenshotsByProject = new Map<string, string[]>();
  for (const row of projectScreenshotsResult.data ?? []) {
    const current = projectScreenshotsByProject.get(row.project_id) ?? [];
    current.push(row.file_path);
    projectScreenshotsByProject.set(row.project_id, current);
  }

  return (projectsRows ?? []).map((row) => ({
    id: row.id,
    name: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    description: row.description ?? "",
    tasks: (tasksByProject.get(row.id) ?? []).sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    ),
    screenshots: projectScreenshotsByProject.get(row.id) ?? [],
  }));
}

async function saveProjectsRemote(
  userId: string,
  projects: Project[],
): Promise<Project[]> {
  if (!supabase) return projects;

  const normalizedProjects: Project[] = await Promise.all(
    projects.map(async (project) => ({
      ...project,
      screenshots: await Promise.all(
        project.screenshots.map((image) =>
          normalizeImageRef(userId, image, PROJECT_SCREENSHOT_BUCKET),
        ),
      ),
      tasks: await Promise.all(
        project.tasks.map(async (task) => ({
          ...task,
          screenshots: await Promise.all(
            (task.screenshots ?? []).map((image) =>
              normalizeImageRef(userId, image, TASK_SCREENSHOT_BUCKET),
            ),
          ),
        })),
      ),
    })),
  );

  const deleteTables = [
    "task_screenshots",
    "project_screenshots",
    "tasks",
    "projects",
  ] as const;

  for (const table of deleteTables) {
    const { error } = await supabase.from(table).delete().eq("user_id", userId);
    if (error) throw error;
  }

  if (normalizedProjects.length === 0) return [];

  const projectRows = normalizedProjects.map((project) => ({
    id: project.id,
    user_id: userId,
    title: project.name,
    description: "",
    created_at: project.createdAt,
    updated_at: project.updatedAt,
  }));

  const { error: projectInsertError } = await supabase
    .from("projects")
    .insert(projectRows);
  if (projectInsertError) throw projectInsertError;

  const taskRows = normalizedProjects.flatMap((project) =>
    project.tasks.map((task, index) => ({
      id: task.id,
      user_id: userId,
      project_id: project.id,
      title: task.title,
      status: task.status,
      created_at: task.createdAt,
      details: task.description ?? "",
      due_date: null,
    })),
  );

  if (taskRows.length > 0) {
    const { error: taskInsertError } = await supabase.from("tasks").insert(taskRows);
    if (taskInsertError) throw taskInsertError;
  }

  const projectScreenshotRows = normalizedProjects.flatMap((project) =>
    project.screenshots.map((image, index) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      project_id: project.id,
      file_path: image,
      caption: null,
    })),
  );

  if (projectScreenshotRows.length > 0) {
    const { error: screenshotInsertError } = await supabase
      .from("project_screenshots")
      .insert(projectScreenshotRows);
    if (screenshotInsertError) throw screenshotInsertError;
  }

  const taskScreenshotRows = normalizedProjects.flatMap((project) =>
    project.tasks.flatMap((task) =>
      (task.screenshots ?? []).map((image, index) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        task_id: task.id,
        file_path: image,
        caption: null,
      })),
    ),
  );

  if (taskScreenshotRows.length > 0) {
    const { error: taskScreenshotInsertError } = await supabase
      .from("task_screenshots")
      .insert(taskScreenshotRows);
    if (taskScreenshotInsertError) throw taskScreenshotInsertError;
  }

  return normalizedProjects;
}

async function getNotesRemote(userId: string): Promise<Note[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("notes")
    .select("id, content, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: NoteRow) => ({
    id: row.id,
    ...deserializeNoteContent(row.content),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function saveNotesRemote(userId: string, notes: Note[]) {
  if (!supabase) return;

  const { error: deleteError } = await supabase
    .from("notes")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  if (notes.length === 0) return;

  const rows = notes.map((note) => ({
    id: note.id,
    user_id: userId,
    content: serializeNoteContent(note),
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  }));

  const { error: insertError } = await supabase.from("notes").insert(rows);
  if (insertError) throw insertError;
}

async function getTimelineRemote(userId: string): Promise<TimelineEvent[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("timeline_events")
    .select("id, project_id, event_type, payload, occurred_at")
    .eq("user_id", userId)
    .order("occurred_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: TimelineRow) => ({
    id: row.id,
    type: row.event_type,
    title: row.payload?.title ?? row.event_type,
    description: row.payload?.description ?? "",
    image: row.payload?.image ?? undefined,
    projectId: row.project_id,
    projectName: row.payload?.projectName ?? undefined,
    timestamp: row.occurred_at,
  }));
}

async function saveTimelineRemote(userId: string, timeline: TimelineEvent[]) {
  if (!supabase) return;

  const { error: deleteError } = await supabase
    .from("timeline_events")
    .delete()
    .eq("user_id", userId);
  if (deleteError) throw deleteError;

  if (timeline.length === 0) return;

  const rows = await Promise.all(
    timeline.map(async (event) => ({
      id: event.id,
      user_id: userId,
      project_id: await resolveTimelineProjectId(userId, event.projectId),
      event_type: event.type,
      payload: {
        title: event.title,
        description: event.description,
        image: event.image,
        projectName: event.projectName,
      },
      occurred_at: event.timestamp,
    })),
  );

  const { error: insertError } = await supabase.from("timeline_events").insert(rows);
  if (insertError) throw insertError;
}

export const store = {
  async getProjects(): Promise<Project[]> {
    const userId = await getUserId();
    if (!userId) return getCachedProjects();

    try {
      const projects = await getProjectsRemote(userId);
      setCachedProjects(projects);
      notifyStoreChange("projects");
      return projects;
    } catch (error) {
      warnFallback((error as Error).message);
      return getCachedProjects();
    }
  },

  async saveProjects(projects: Project[]) {
    const userId = await getUserId();
    if (!userId) {
      setCachedProjects(projects);
      return;
    }

    try {
      const normalized = await saveProjectsRemote(userId, projects);
      setCachedProjects(normalized);
      notifyStoreChange("projects");
      return;
    } catch (error) {
      warnFallback((error as Error).message);
    }

    setCachedProjects(projects);
    notifyStoreChange("projects");
  },

  async getNotes(): Promise<Note[]> {
    const userId = await getUserId();
    if (!userId) return getCachedNotes();

    try {
      const notes = await getNotesRemote(userId);
      setCachedNotes(notes);
      notifyStoreChange("notes");
      return notes;
    } catch (error) {
      warnFallback((error as Error).message);
      return getCachedNotes();
    }
  },

  async saveNotes(notes: Note[]) {
    const userId = await getUserId();
    if (!userId) {
      setCachedNotes(notes);
      return;
    }

    try {
      await saveNotesRemote(userId, notes);
    } catch (error) {
      warnFallback((error as Error).message);
    }

    setCachedNotes(notes);
    notifyStoreChange("notes");
  },

  async getTimeline(): Promise<TimelineEvent[]> {
    const userId = await getUserId();
    if (!userId) return getCachedTimeline();

    try {
      const timeline = await getTimelineRemote(userId);
      setCachedTimeline(timeline);
      notifyStoreChange("timeline");
      return timeline;
    } catch (error) {
      warnFallback((error as Error).message);
      return getCachedTimeline();
    }
  },

  async saveTimeline(timeline: TimelineEvent[]) {
    const userId = await getUserId();
    if (!userId) {
      setCachedTimeline(timeline);
      return;
    }

    try {
      await saveTimelineRemote(userId, timeline);
    } catch (error) {
      warnFallback((error as Error).message);
    }

    setCachedTimeline(timeline);
    notifyStoreChange("timeline");
  },

  async addTimelineEvent(
    event: Omit<TimelineEvent, "id" | "timestamp">,
  ): Promise<TimelineEvent> {
    const newEvent: TimelineEvent = {
      ...event,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    };

    const userId = await getUserId();
    if (userId && supabase) {
      try {
        const { data, error } = await supabase
          .from("timeline_events")
          .insert({
            id: newEvent.id,
            user_id: userId,
            project_id: await resolveTimelineProjectId(userId, newEvent.projectId),
            event_type: newEvent.type,
            payload: {
              title: newEvent.title,
              description: newEvent.description,
              image: newEvent.image ?? null,
              projectName: newEvent.projectName ?? null,
            },
            occurred_at: newEvent.timestamp,
          })
          .select("id, project_id, event_type, payload, occurred_at")
          .single();

        if (error) throw error;

        const remoteEvent: TimelineEvent = {
          id: data.id,
          type: data.event_type,
          title: data.payload?.title ?? data.event_type,
          description: data.payload?.description ?? "",
          image: data.payload?.image ?? undefined,
          projectId: data.project_id,
          projectName: data.payload?.projectName ?? undefined,
          timestamp: data.occurred_at,
        };

        const localTimeline = getCachedTimeline();
        localTimeline.unshift(remoteEvent);
        setCachedTimeline(localTimeline);
        notifyStoreChange("timeline");
        return remoteEvent;
      } catch (error) {
        warnFallback((error as Error).message);
      }
    }

    const timeline = getCachedTimeline();
    timeline.unshift(newEvent);
    setCachedTimeline(timeline);
    notifyStoreChange("timeline");
    return newEvent;
  },

  uid: () => crypto.randomUUID(),
};
