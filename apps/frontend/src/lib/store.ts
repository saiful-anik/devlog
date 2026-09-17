import { getSession } from "@/lib/auth";
import { apiFetch, apiUrl } from "@/lib/api";

export interface Task { id: string; title: string; status: "backlog" | "in-progress" | "completed"; createdAt: string; description?: string; reference?: string; order?: number; }
export interface Project { id: string; name: string; description?: string; tasks: Task[]; createdAt: string; updatedAt: string; }
export interface Note { id: string; title: string; content: string; createdAt: string; updatedAt: string; }
export interface TimelineEvent { id: string; type: "project" | "task" | "log" | "screenshot" | "custom"; title: string; description: string; image?: string; projectId?: string; projectName?: string; timestamp: string; }
export interface ProjectScreenshot { id: string; user_id: string; project_id: string; file_path: string; caption?: string; created_at: string; updated_at: string; }
export type StoreScope = "projects" | "notes" | "timeline";

const listeners = new Set<(scope: StoreScope) => void>();
const syncListeners = new Set<(status: "idle" | "syncing" | "error") => void>();
let status: "idle" | "syncing" | "error" = "idle";
let cachedProjects: Project[] = [];
let cachedNotes: Note[] = [];
let cachedTimeline: TimelineEvent[] = [];
let projectsLoaded = false;
let notesLoaded = false;
let timelineLoaded = false;

const api = (path: string, init?: RequestInit) => apiFetch(path, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
const notify = (scope: StoreScope) => listeners.forEach((listener) => listener(scope));
const setStatus = (next: typeof status) => { status = next; syncListeners.forEach((listener) => listener(next)); };

export const getCachedProjects = () => structuredClone(cachedProjects);
export const getCachedNotes = () => structuredClone(cachedNotes);
export const getCachedTimeline = () => structuredClone(cachedTimeline);
export const resolveImageSrc = (value?: string) => value?.startsWith("/api/") ? apiUrl(value) : value || "";
export const getScreenshotSizeLimit = async () => 5 * 1024 * 1024;
export const formatBytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(2)}MB`;
export class FileSizeError extends Error { constructor(public actualSize: number) { super(`File too large (${formatBytes(actualSize)}). Max 5MB allowed.`); this.name = "FileSizeError"; } }
export const subscribeToStoreChanges = (listener: (scope: StoreScope) => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export async function startStoreSync(_userId?: string) { return; }
export async function resetStoreSync() { cachedProjects = []; cachedNotes = []; cachedTimeline = []; projectsLoaded = false; notesLoaded = false; timelineLoaded = false; }

async function load(scope: StoreScope) {
  const user = await getSession();
  if (!user) throw new Error("Sign in with GitHub to access DevLog");
  const response = await api(`/api/state?userId=${encodeURIComponent(user.id)}&scope=${scope}`);
  const result = await response.json();
  if (!response.ok || result.status !== "ok") throw new Error(result.error || "Unable to load data");
  if (scope === "projects") {
    const tasksByProject = new Map<string, Task[]>();
    for (const task of result.data.tasks) {
      const list = tasksByProject.get(task.projectId) || [];
      list.push({ id: task.id, title: task.title, status: task.status, createdAt: task.createdAt, description: task.details || "", reference: task.resourcePath || "", order: list.length });
      tasksByProject.set(task.projectId, list);
    }
    cachedProjects = result.data.projects.map((project: any) => ({ id: project.id, name: project.title, description: project.description || "", createdAt: project.createdAt, updatedAt: project.updatedAt, tasks: tasksByProject.get(project.id) || [] }));
    projectsLoaded = true;
  }
  if (scope === "notes") { cachedNotes = result.data.notes.map((note: any) => ({ id: note.id, title: note.title || "Untitled Note", content: note.content, createdAt: note.createdAt, updatedAt: note.updatedAt })); notesLoaded = true; }
  if (scope === "timeline") { cachedTimeline = result.data.timeline.map((event: any) => ({ id: event.id, type: event.eventType, title: event.payload?.title || event.eventType, description: event.payload?.description || "", image: event.payload?.image, projectId: event.projectId || undefined, projectName: event.payload?.projectName, timestamp: event.occurredAt })); timelineLoaded = true; }
  return { projects: getCachedProjects(), notes: getCachedNotes(), timeline: getCachedTimeline() };
}

async function save(scope: StoreScope) {
  const user = await getSession();
  if (!user) throw new Error("Sign in with GitHub to access DevLog");
  setStatus("syncing");
  try {
    const response = await api("/api/state", { method: "PUT", body: JSON.stringify({ userId: user.id, scope, projects: cachedProjects, notes: cachedNotes, timeline: cachedTimeline }) });
    const result = await response.json();
    if (!response.ok || result.status !== "ok") throw new Error(result.error || "Unable to save data");
    setStatus("idle");
  } catch (error) { setStatus("error"); throw error; }
}

export const store = {
  async getProjects() { if (!projectsLoaded) await load("projects"); return getCachedProjects(); },
  async saveProjects(projects: Project[]) { cachedProjects = structuredClone(projects); projectsLoaded = true; notify("projects"); await save("projects"); },
  async getNotes() { if (!notesLoaded) await load("notes"); return getCachedNotes(); },
  async saveNotes(notes: Note[]) { cachedNotes = structuredClone(notes); notesLoaded = true; notify("notes"); await save("notes"); },
  async getTimeline() { if (!timelineLoaded) await load("timeline"); return getCachedTimeline(); },
  async saveTimeline(timeline: TimelineEvent[]) { cachedTimeline = structuredClone(timeline); timelineLoaded = true; notify("timeline"); await save("timeline"); },
  async addTimelineEvent(event: Omit<TimelineEvent, "id" | "timestamp">) { if (!timelineLoaded) await load("timeline"); const value = { ...event, id: crypto.randomUUID(), timestamp: new Date().toISOString() } as TimelineEvent; cachedTimeline = [value, ...cachedTimeline]; timelineLoaded = true; notify("timeline"); void save("timeline"); return value; },
  uid: () => crypto.randomUUID(),
  getSyncStatus: () => status,
  onSyncStatusChange(listener: (value: typeof status) => void) { syncListeners.add(listener); return () => { syncListeners.delete(listener); }; },
  _internal_incrementPendingSync() { setStatus("syncing"); },
  _internal_decrementPendingSync(error = false) { setStatus(error ? "error" : "idle"); },
};
