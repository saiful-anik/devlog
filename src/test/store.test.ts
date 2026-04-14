import { beforeEach, describe, expect, it, vi } from "vitest";

type InsertCall = { table: string; payload: any };
type UpsertCall = { table: string; payload: any };

const insertCalls: InsertCall[] = [];
const upsertCalls: UpsertCall[] = [];

const mockSupabase = {
  auth: {
    getSession: vi.fn(async () => ({
      data: { session: { user: { id: "user-1" } } },
      error: null,
    })),
  },
  removeChannel: vi.fn(async () => ({})),
  channel: vi.fn(() => {
    const channelApi = {
      on: vi.fn(() => channelApi),
      subscribe: vi.fn(async () => ({})),
    };
    return channelApi;
  }),
  storage: {
    from: vi.fn(() => ({
      getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://example.com/image.png" } })),
    })),
  },
  from: vi.fn((table: string) => {
    const query = {
      select: vi.fn(() => ({
        eq: vi.fn(async () => ({ data: [], error: null })),
        in: vi.fn(() => ({
          order: vi.fn(async () => ({ data: [], error: null })),
        })),
        order: vi.fn(async () => ({ data: [], error: null })),
        limit: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({ data: null, error: null })),
        })),
      })),
      delete: vi.fn(() => ({
        eq: vi.fn(async () => ({ error: null })),
        in: vi.fn(async () => ({ error: null })),
      })),
      upsert: vi.fn(async (payload: any) => {
        upsertCalls.push({ table, payload });
        return { error: null };
      }),
      insert: vi.fn(async (payload: any) => {
        insertCalls.push({ table, payload });
        return { error: null };
      }),
    };
    return query;
  }),
};

vi.mock("@/lib/supabase", () => ({
  supabase: mockSupabase,
  hasSupabaseConfig: true,
}));

describe("store schema behaviors", () => {
  beforeEach(() => {
    insertCalls.length = 0;
    upsertCalls.length = 0;
    vi.clearAllMocks();
  });

  it("adds timeline events without requiring project_id", async () => {
    const { store } = await import("@/lib/store");

    await store.addTimelineEvent({
      type: "custom",
      title: "Independent event",
      description: "No project attached",
    });

    await vi.waitFor(() => {
      expect(insertCalls.some((call) => call.table === "timeline_events")).toBe(true);
    });

    const timelineInsert = insertCalls.find((call) => call.table === "timeline_events");
    expect(timelineInsert?.payload.project_id).toBeNull();
    expect(timelineInsert?.payload.payload.title).toBe("Independent event");
  });

  it("persists task reference into tasks.resource_path", async () => {
    const { store } = await import("@/lib/store");

    await store.saveProjects([
      {
        id: "project-1",
        name: "Project A",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        tasks: [
          {
            id: "task-1",
            title: "Task with file",
            status: "backlog",
            createdAt: "2026-04-10T00:00:00.000Z",
            description: "detail",
            reference: "C:/shots/task-1.png",
            order: 0,
          },
        ],
      },
    ]);

    const tasksUpsert = upsertCalls.find((call) => call.table === "tasks");
    expect(tasksUpsert).toBeDefined();
    expect(tasksUpsert?.payload[0].resource_path).toBe("C:/shots/task-1.png");
    expect(tasksUpsert?.payload[0].due_date).toBeUndefined();
  });

  it("preserves each project's updatedAt when saving", async () => {
    const { store } = await import("@/lib/store");

    await store.saveProjects([
      {
        id: "project-1",
        name: "Project A",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T01:00:00.000Z",
        tasks: [],
      },
      {
        id: "project-2",
        name: "Project B",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T02:00:00.000Z",
        tasks: [],
      },
    ]);

    const projectsUpsert = upsertCalls.find((call) => call.table === "projects");
    expect(projectsUpsert).toBeDefined();
    expect(projectsUpsert?.payload[0].updated_at).toBe("2026-04-10T01:00:00.000Z");
    expect(projectsUpsert?.payload[1].updated_at).toBe("2026-04-10T02:00:00.000Z");
  });

  it("does not start realtime sync during user id lookup", async () => {
    const { store } = await import("@/lib/store");

    await store.getProjects();

    expect(mockSupabase.channel).not.toHaveBeenCalled();
  });
});
