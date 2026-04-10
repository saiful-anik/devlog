import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import ProjectDetail from "@/pages/ProjectDetail";

const navigateMock = vi.fn();
const saveProjectsMock = vi.fn(async (_projects: any[]) => undefined);
const getProjectsMock = vi.fn(async () => [] as any[]);

let projectsData: any[] = [];

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useParams: () => ({ id: "project-1" }),
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/hooks/useStoreSubscription", () => ({
  useStoreSubscription: vi.fn(),
}));

vi.mock("@/lib/store", () => ({
  getCachedProjects: () => projectsData,
  store: {
    uid: () => "new-id",
    getProjects: (...args: any[]) => getProjectsMock(...args),
    saveProjects: (...args: any[]) => saveProjectsMock(...args),
    addTimelineEvent: vi.fn(async () => undefined),
    _internal_incrementPendingSync: vi.fn(),
    _internal_decrementPendingSync: vi.fn(),
  },
}));

describe("ProjectDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    projectsData = [
      {
        id: "project-1",
        name: "Project A",
        description: "",
        createdAt: "2026-04-10T00:00:00.000Z",
        updatedAt: "2026-04-10T00:00:00.000Z",
        tasks: [
          {
            id: "task-1",
            title: "Task 1",
            status: "backlog",
            createdAt: "2026-04-10T00:00:00.000Z",
            description: "old",
            reference: "",
            order: 0,
          },
        ],
      },
    ];

    getProjectsMock.mockImplementation(async () => projectsData);
    saveProjectsMock.mockImplementation(async (nextProjects: any[]) => {
      projectsData = nextProjects;
    });
  });

  it("updates task URL/filepath reference and saves project", async () => {
    render(<ProjectDetail />);

    await screen.findByText("Project A");

    fireEvent.click(screen.getByText("Task 1"));

    const referenceInput = await screen.findByPlaceholderText("URL or file path (optional)");
    fireEvent.change(referenceInput, { target: { value: "https://example.com/task-file.png" } });

    await waitFor(() => {
      expect(saveProjectsMock).toHaveBeenCalled();
    });

    const savedProjects = saveProjectsMock.mock.calls.at(-1)?.[0] as any[];
    expect(savedProjects[0].tasks[0].reference).toBe("https://example.com/task-file.png");
  });
});
