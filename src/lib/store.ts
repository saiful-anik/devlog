import { supabase } from "@/lib/supabase";
import type { RealtimeChannel } from "@supabase/supabase-js";

const FALLBACK_SCREENSHOT_SIZE = 2 * 1024 * 1024;

export async function getScreenshotSizeLimit(): Promise<number> {
  return FALLBACK_SCREENSHOT_SIZE;
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)}MB`;
}

export class FileSizeError extends Error {
  constructor(public actualSize: number, public maxSize: number) {
    super(`File too large (${formatBytes(actualSize)}). Max ${formatBytes(maxSize)} allowed.`);
    this.name = "FileSizeError";
  }
}

export interface Task {
  id: string;
  title: string;
  status: "backlog" | "in-progress" | "completed";
  createdAt: string;
  description?: string;
  reference?: string;
  order?: number;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  tasks: Task[];
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
  type: "project" | "task" | "log" | "screenshot" | "custom";
  title: string;
  description: string;
  image?: string;
  projectId?: string;
  projectName?: string;
  timestamp: string;
}

export interface ProjectScreenshot {
  id: string;
  user_id: string;
  project_id: string;
  file_path: string;
  caption?: string;
  created_at: string;
  updated_at: string;
}

export type StoreScope = "projects" | "notes" | "timeline";

type StoreListener = (scope: StoreScope) => void;
type SyncStatusListener = (status: "idle" | "syncing" | "error") => void;

const listeners = new Set<StoreListener>();
const syncStatusListeners = new Set<SyncStatusListener>();

let syncStatus: "idle" | "syncing" | "error" = "idle";
let pendingSyncOperations = 0;
let lastSyncError: string | null = null;

let cachedProjects: Project[] = [];
let cachedNotes: Note[] = [];
let cachedTimeline: TimelineEvent[] = [];

let realtimeChannel: RealtimeChannel | null = null;
let realtimeUserId: string | null = null;
let realtimeSetupPromise: Promise<void> | null = null;

function cloneProjects(projects: Project[]) {
  return projects.map((project) => ({
    ...project,
    tasks: project.tasks.map((task) => ({ ...task })),
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

  const previousById = new Map(cachedProjects.map((project) => [project.id, project]));

  const merged = projects.map((project) => {
    const previous = previousById.get(project.id);
    if (!previous) return project;

    const nextUpdatedAt = Date.parse(project.updatedAt);
    const prevUpdatedAt = Date.parse(previous.updatedAt);

    if (!Number.isNaN(prevUpdatedAt) && (Number.isNaN(nextUpdatedAt) || prevUpdatedAt > nextUpdatedAt)) {
      return {
        ...project,
        updatedAt: previous.updatedAt,
      };
    }

    return project;
  });

  cachedProjects = cloneProjects(merged);
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

function notifyStoreChange(scope: StoreScope, force = false) {
  // Skip notifications while there are pending syncs to avoid overwriting optimistic updates.
  // Callers can force a notification for optimistic writes that should render immediately.
  if (!force && pendingSyncOperations > 0) return;

  for (const listener of listeners) {
    listener(scope);
  }
}

function notifySyncStatus() {
  for (const listener of syncStatusListeners) {
    listener(syncStatus);
  }
}

function updateSyncStatus(newStatus: "idle" | "syncing" | "error") {
  if (syncStatus !== newStatus) {
    syncStatus = newStatus;
    notifySyncStatus();
  }
}

function incrementPendingSync() {
  pendingSyncOperations += 1;
  updateSyncStatus("syncing");
}

function decrementPendingSync(hasError = false) {
  pendingSyncOperations = Math.max(0, pendingSyncOperations - 1);
  if (hasError) {
    updateSyncStatus("error");
  } else if (pendingSyncOperations === 0) {
    updateSyncStatus("idle");
    // Notify listeners that sync is complete so they can refresh from server
    notifyStoreChange("projects");
    notifyStoreChange("notes");
    notifyStoreChange("timeline");
  }
}

let warnedFallback = false;
let lastFallbackReason: string | null = null;

function warnFallback(reason: string) {
  lastFallbackReason = reason;
  if (warnedFallback) return;
  warnedFallback = true;
}

async function stopRealtimeSync() {
  const channel = realtimeChannel;

  if (channel && supabase) {
    try {
      await supabase.removeChannel(channel);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("WebSocket is closed before the connection is established")) {
        warnFallback(message);
      }
    }
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

export async function startStoreSync(userId: string) {
  await ensureRealtimeSync(userId);
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
  resource_path: string | null;
};

type NoteRow = {
  id: string;
  title: string | null;
  content: string;
  created_at: string;
  updated_at: string;
};

type TimelineRow = {
  id: string;
  project_id: string | null;
  event_type: TimelineEvent["type"];
  payload: { title?: string; description?: string; image?: string; projectName?: string } | null;
  occurred_at: string;
};

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
): Promise<string | null> {
  if (!supabase) throw new Error("Supabase unavailable");

  if (!preferredProjectId) return null;

  const { data, error } = await supabase
    .from("projects")
    .select("id")
    .eq("user_id", userId)
    .eq("id", preferredProjectId)
    .limit(1)
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
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

  const tasksResult = projectIds.length
    ? await supabase
        .from("tasks")
        .select("id, project_id, title, status, created_at, details, resource_path")
        .eq("user_id", userId)
        .in("project_id", projectIds)
        .order("created_at", { ascending: true })
    : { data: [] as TaskRow[], error: null };

  if (tasksResult.error) throw tasksResult.error;

  const tasksByProject = new Map<string, Task[]>();

  for (const row of tasksResult.data ?? []) {
    const list = tasksByProject.get(row.project_id) ?? [];
    const task: Task = {
      id: row.id,
      title: row.title,
      status: row.status,
      createdAt: row.created_at,
      description: row.details ?? "",
      reference: row.resource_path ?? "",
      order: list.length,
    };

    list.push(task);
    tasksByProject.set(row.project_id, list);
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
  }));
}

async function saveProjectsRemote(
  userId: string,
  projects: Project[],
): Promise<Project[]> {
  if (!supabase) return projects;

  const normalizedProjects: Project[] = projects.map((project) => ({
    ...project,
    tasks: project.tasks.map((task) => ({ ...task })),
  }));

  const newProjectIds = new Set(normalizedProjects.map((p) => p.id));
  const newTaskIds = new Set(normalizedProjects.flatMap((p) => p.tasks.map((t) => t.id)));

  // Delete removed projects.
  const { data: existingProjects } = await supabase
    .from("projects")
    .select("id, title, description, created_at, updated_at")
    .eq("user_id", userId);

  const existingProjectById = new Map(
    (existingProjects ?? []).map(
      (row: {
        id: string;
        title?: string | null;
        description?: string | null;
        created_at?: string | null;
        updated_at?: string | null;
      }) => [row.id, row],
    ),
  );

  const existingUpdatedAtById = new Map(
    (existingProjects ?? []).map((row: { id: string; updated_at?: string | null }) => [
      row.id,
      row.updated_at ?? null,
    ]),
  );

  const syncedProjects: Project[] = normalizedProjects.map((project) => {
    const existingUpdatedAt = existingUpdatedAtById.get(project.id);
    const incomingMs = Date.parse(project.updatedAt);
    const existingMs = existingUpdatedAt ? Date.parse(existingUpdatedAt) : NaN;

    if (!Number.isNaN(existingMs) && (Number.isNaN(incomingMs) || existingMs > incomingMs)) {
      return {
        ...project,
        updatedAt: existingUpdatedAt as string,
      };
    }

    return project;
  });

  const staleProjectIds = (existingProjects ?? [])
    .map((r) => r.id)
    .filter((id) => !newProjectIds.has(id));
  if (staleProjectIds.length > 0) {
    await supabase.from("projects").delete().in("id", staleProjectIds);
  }

  // Delete removed tasks
  const { data: existingTasks } = await supabase
    .from("tasks")
    .select("id, project_id, title, status, created_at, details, resource_path")
    .eq("user_id", userId);

  const existingTaskById = new Map(
    (existingTasks ?? []).map(
      (row: {
        id: string;
        project_id: string;
        title: string;
        status: Task["status"];
        created_at: string;
        details?: string | null;
        resource_path?: string | null;
      }) => [row.id, row],
    ),
  );

  const staleTaskIds = (existingTasks ?? [])
    .map((r) => r.id)
    .filter((id) => !newTaskIds.has(id));

  const changedProjectIds = new Set<string>();

  for (const project of syncedProjects) {
    const existingProject = existingProjectById.get(project.id);

    if (!existingProject) {
      changedProjectIds.add(project.id);
      continue;
    }

    if (
      existingProject.title !== project.name ||
      (existingProject.description ?? "") !== (project.description ?? "") ||
      existingProject.created_at !== project.createdAt ||
      existingProject.updated_at !== project.updatedAt
    ) {
      changedProjectIds.add(project.id);
    }
  }

  for (const staleTask of existingTasks ?? []) {
    if (staleTaskIds.includes(staleTask.id)) {
      changedProjectIds.add(staleTask.project_id);
    }
  }

  const changedTaskRows = syncedProjects.flatMap((project) =>
    project.tasks
      .map((task) => ({
        id: task.id,
        user_id: userId,
        project_id: project.id,
        title: task.title,
        status: task.status,
        created_at: task.createdAt,
        details: task.description ?? "",
        resource_path: task.reference ?? null,
      }))
      .filter((taskRow) => {
        const existingTask = existingTaskById.get(taskRow.id);
        if (!existingTask) {
          changedProjectIds.add(taskRow.project_id);
          return true;
        }

        const hasChanged =
          existingTask.project_id !== taskRow.project_id ||
          existingTask.title !== taskRow.title ||
          existingTask.status !== taskRow.status ||
          existingTask.created_at !== taskRow.created_at ||
          (existingTask.details ?? "") !== taskRow.details ||
          (existingTask.resource_path ?? null) !== taskRow.resource_path;

        if (hasChanged) {
          changedProjectIds.add(taskRow.project_id);
        }

        return hasChanged;
      }),
  );

  if (staleTaskIds.length > 0) {
    await supabase.from("tasks").delete().in("id", staleTaskIds);
  }

  if (normalizedProjects.length === 0) return [];

  // Upsert changed tasks only.
  if (changedTaskRows.length > 0) {
    const { error: taskError } = await supabase
      .from("tasks")
      .upsert(changedTaskRows, { onConflict: "id" });
    if (taskError) throw taskError;
  }

  // Upsert changed projects only.
  const projectRows = syncedProjects
    .filter((project) => changedProjectIds.has(project.id))
    .map((project) => ({
      id: project.id,
      user_id: userId,
      title: project.name,
      description: project.description ?? "",
      created_at: project.createdAt,
      updated_at: project.updatedAt,
    }));

  if (projectRows.length > 0) {
    const { error: projectError } = await supabase
      .from("projects")
      .upsert(projectRows, { onConflict: "id" });
    if (projectError) throw projectError;
  }

  return syncedProjects;
}

async function getNotesRemote(userId: string): Promise<Note[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("notes")
    .select("id, title, content, created_at, updated_at")
    .eq("user_id", userId)
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return (data ?? []).map((row: NoteRow) => ({
    id: row.id,
    title: row.title ?? deserializeNoteContent(row.content).title,
    content: deserializeNoteContent(row.content).content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function saveNotesRemote(userId: string, notes: Note[]) {
  if (!supabase) return;

  const newNoteIds = new Set(notes.map((n) => n.id));

  // Delete removed notes
  const { data: existing } = await supabase
    .from("notes")
    .select("id")
    .eq("user_id", userId);
  const staleIds = (existing ?? []).map((r) => r.id).filter((id) => !newNoteIds.has(id));
  if (staleIds.length > 0) {
    await supabase.from("notes").delete().in("id", staleIds);
  }

  if (notes.length === 0) return;

  // Upsert remaining
  const rows = notes.map((note) => ({
    id: note.id,
    user_id: userId,
    title: note.title,
    content: note.content,
    created_at: note.createdAt,
    updated_at: note.updatedAt,
  }));

  const { error } = await supabase.from("notes").upsert(rows, { onConflict: "id" });
  if (error) throw error;
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
    projectId: row.project_id ?? undefined,
    projectName: row.payload?.projectName ?? undefined,
    timestamp: row.occurred_at,
  }));
}

async function saveTimelineRemote(userId: string, timeline: TimelineEvent[]) {
  if (!supabase) return;

  const newIds = new Set(timeline.map((e) => e.id));

  // Delete removed events
  const { data: existing } = await supabase
    .from("timeline_events")
    .select("id")
    .eq("user_id", userId);
  const staleIds = (existing ?? []).map((r) => r.id).filter((id) => !newIds.has(id));
  if (staleIds.length > 0) {
    await supabase.from("timeline_events").delete().in("id", staleIds);
  }

  if (timeline.length === 0) return;

  // Upsert remaining
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

  const { error } = await supabase.from("timeline_events").upsert(rows, { onConflict: "id" });
  if (error) throw error;
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

    const nextTimeline = [newEvent, ...getCachedTimeline()];
    setCachedTimeline(nextTimeline);
    notifyStoreChange("timeline", true);

    void (async () => {
      const userId = await getUserId();
      if (!userId || !supabase) return;

      incrementPendingSync();
      try {
        const { error } = await supabase.from("timeline_events").insert({
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
        });

        if (error) throw error;
        decrementPendingSync(false);
      } catch (error) {
        warnFallback((error as Error).message);
        decrementPendingSync(true);
      }
    })();

    return newEvent;
  },

  uid: () => crypto.randomUUID(),

  getSyncStatus: () => syncStatus,

  onSyncStatusChange(listener: SyncStatusListener) {
    syncStatusListeners.add(listener);
    return () => {
      syncStatusListeners.delete(listener);
    };
  },

  _internal_incrementPendingSync: incrementPendingSync,
  _internal_decrementPendingSync: decrementPendingSync,
};
