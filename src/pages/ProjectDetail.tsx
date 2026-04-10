import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, ImagePlus, X } from "lucide-react";
import {
  store,
  Project,
  Task,
  getCachedProjects,
  resolveImageSrc,
} from "@/lib/store";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const COLUMNS: { key: Task["status"]; label: string; color: string }[] = [
  { key: "backlog", label: "Backlog", color: "bg-primary" },
  { key: "in-progress", label: "In Progress", color: "bg-warning" },
  { key: "completed", label: "Completed", color: "bg-success" },
];

function normalizeProject(project: Project | null): Project | null {
  if (!project) return null;

  const normalizedTasks = project.tasks.map((task, index) => ({
    ...task,
    description: task.description ?? "",
    order: typeof task.order === "number" ? task.order : index,
  }));

  return {
    ...project,
    screenshots: project.screenshots ?? [],
    tasks: normalizedTasks,
  };
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [taskName, setTaskName] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<
    "idle" | "loading" | "ready" | "empty" | "error"
  >("idle");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFilePreview, setPendingFilePreview] = useState<string | null>(
    null,
  );
  const [isLoading, setIsLoading] = useState(true);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const taskDetailsSaveTimeoutRef = useRef<number | null>(null);
  const pendingTaskDetailsProjectRef = useRef<Project | null>(null);
  const chooserFileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const projects = await store.getProjects();
      const current = normalizeProject(
        projects.find((item) => item.id === id) ?? null,
      );
      if (!active) return;

      if (!current) {
        setProject(null);
        setIsLoading(false);
        return;
      }

      setProject(current);
      setEditName(current.name);
      setIsLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, [id]);

  useStoreSubscription(["projects"], () => {
    if (dragTaskId) return;

    const current = normalizeProject(
      getCachedProjects().find((item) => item.id === id) ?? null,
    );
    if (!current) {
      setProject(null);
      return;
    }

    setProject(current);
    setEditName(current.name);
  });

  const save = async (updatedProject: Project) => {
    const all = (await store.getProjects()).map((item) =>
      item.id === updatedProject.id ? updatedProject : item,
    );
    await store.saveProjects(all);
    setProject({ ...updatedProject });
  };

  const persistProjectWithSyncStatus = async (updatedProject: Project) => {
    store._internal_incrementPendingSync();
    try {
      await save(updatedProject);
      store._internal_decrementPendingSync(false);
    } catch {
      store._internal_decrementPendingSync(true);
    }
  };

  const updateTaskDetailsState = (updatedProject: Project) => {
    pendingTaskDetailsProjectRef.current = updatedProject;
    setProject(updatedProject);
  };

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read image file"));
      reader.readAsDataURL(file);
    });

  const readClipboardImage = async () => {
    if (!navigator.clipboard?.read) {
      setClipboardStatus("empty");
      setClipboardImage(null);
      return;
    }

    try {
      setClipboardStatus("loading");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;

        const blob = await item.getType(imageType);
        const dataUrl = await readFileAsDataUrl(
          new File([blob], "clipboard-image", { type: blob.type }),
        );
        setClipboardImage(dataUrl);
        setClipboardStatus("ready");
        return;
      }

      setClipboardImage(null);
      setClipboardStatus("empty");
    } catch {
      setClipboardImage(null);
      setClipboardStatus("error");
    }
  };

  const openImageChooser = () => {
    setPendingFile(null);
    setPendingFilePreview(null);
    setClipboardImage(null);
    setClipboardStatus("idle");
    setImagePickerOpen(true);
    void readClipboardImage();
  };

  const closeImageChooser = () => {
    setImagePickerOpen(false);
    setPendingFile(null);
    setPendingFilePreview(null);
    setClipboardImage(null);
    setClipboardStatus("idle");
  };

  const handleChooserFileChange = async (
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0] ?? null;
    setPendingFile(file);
    if (file) {
      setPendingFilePreview(await readFileAsDataUrl(file));
    } else {
      setPendingFilePreview(null);
    }
  };

  const commitChosenImage = () => {
    void (async () => {
      const source =
        pendingFile ??
        (clipboardImage
          ? new File(
              [await (await fetch(clipboardImage)).blob()],
              "clipboard-image",
            )
          : null);
      if (!source) return;

      await addProjectScreenshot(source);
      closeImageChooser();
    })();
  };

  const addProjectScreenshot = async (file: File) => {
    if (!project) return;
    const data = await readFileAsDataUrl(file);
    project.screenshots.push(data);
    project.updatedAt = new Date().toISOString();

    setProject({ ...project });

    store._internal_incrementPendingSync();
    try {
      await save(project);
      await store.addTimelineEvent({
        type: "log",
        title: "Screenshot uploaded",
        description: "",
        projectId: project.id,
        projectName: project.name,
        image: data,
      });
      store._internal_decrementPendingSync(false);
    } catch (error) {
      console.error("Failed to sync screenshot:", error);
      store._internal_decrementPendingSync(true);
    }
  };

  const removeProjectScreenshot = (index: number) => {
    if (!project) return;

    project.screenshots = project.screenshots.filter((_, i) => i !== index);
    project.updatedAt = new Date().toISOString();
    setProject({ ...project });

    void (async () => {
      store._internal_incrementPendingSync();
      try {
        await save(project);
        store._internal_decrementPendingSync(false);
      } catch {
        store._internal_decrementPendingSync(true);
      }
    })();
  };

  const sortByOrder = (tasks: Task[]) =>
    [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const rebalanceStatus = (tasks: Task[], status: Task["status"]) => {
    sortByOrder(tasks.filter((task) => task.status === status)).forEach(
      (task, index) => {
        task.order = index;
      },
    );
  };

  const nextOrder = (tasks: Task[], status: Task["status"]) => {
    const inColumn = sortByOrder(
      tasks.filter((task) => task.status === status),
    );
    if (inColumn.length === 0) return 0;
    return (inColumn[inColumn.length - 1].order ?? 0) + 1;
  };

  const addTask = () => {
    if (!project || !taskName.trim()) return;
    pendingTaskDetailsProjectRef.current = null;

    const task: Task = {
      id: store.uid(),
      title: taskName.trim(),
      status: "backlog",
      createdAt: new Date().toISOString(),
      description: "",
      order: nextOrder(project.tasks, "backlog"),
    };

    project.tasks.push(task);
    project.updatedAt = new Date().toISOString();
    setProject({ ...project });
    setTaskName("");
    setTaskOpen(false);

    void store.addTimelineEvent({
      type: "task",
      title: task.title,
      description: `Added to ${project.name}`,
      projectId: project.id,
      projectName: project.name,
    });

    void (async () => {
      store._internal_incrementPendingSync();
      try {
        const all = (await store.getProjects()).map((item) =>
          item.id === project.id ? project : item,
        );
        await store.saveProjects(all);
        store._internal_decrementPendingSync(false);
      } catch {
        store._internal_decrementPendingSync(true);
      }
    })();
  };

  const renameProject = () => {
    if (!project || !editName.trim()) return;
    pendingTaskDetailsProjectRef.current = null;

    project.name = editName.trim();
    project.updatedAt = new Date().toISOString();
    setProject({ ...project });
    setEditOpen(false);

    void (async () => {
      store._internal_incrementPendingSync();
      try {
        await save(project);
        store._internal_decrementPendingSync(false);
      } catch {
        store._internal_decrementPendingSync(true);
      }
    })();
  };

  const selectedTask = useMemo(() => {
    if (!project || !selectedTaskId) return null;
    return project.tasks.find((task) => task.id === selectedTaskId) ?? null;
  }, [project, selectedTaskId]);

  const openTaskDetails = (taskId: string) => {
    setSelectedTaskId(taskId);
    setTaskDetailsOpen(true);
  };

  const closeTaskDetails = () => {
    const pendingProject = pendingTaskDetailsProjectRef.current;
    pendingTaskDetailsProjectRef.current = null;
    if (pendingProject) {
      void persistProjectWithSyncStatus(pendingProject);
    }
    setTaskDetailsOpen(false);
  };

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    if (!project) return;

    const nextProject: Project = {
      ...project,
      tasks: project.tasks.map((task) =>
        task.id === taskId ? { ...task, ...updates } : task,
      ),
      updatedAt: new Date().toISOString(),
    };

    updateTaskDetailsState(nextProject);
  };

  const confirmDeleteTask = () => {
    if (!project || !deleteTaskId) return;
    pendingTaskDetailsProjectRef.current = null;

    const task = project.tasks.find((item) => item.id === deleteTaskId);
    project.tasks = project.tasks.filter((item) => item.id !== deleteTaskId);
    rebalanceStatus(project.tasks, "backlog");
    rebalanceStatus(project.tasks, "in-progress");
    rebalanceStatus(project.tasks, "completed");
    project.updatedAt = new Date().toISOString();

    setProject({ ...project });
    setDeleteTaskId(null);

    if (task) {
      void store.addTimelineEvent({
        type: "task",
        title: `Task deleted: ${task.title}`,
        description: "",
        projectId: project.id,
        projectName: project.name,
      });
    }

    void (async () => {
      store._internal_incrementPendingSync();
      try {
        await save(project);
        store._internal_decrementPendingSync(false);
      } catch {
        store._internal_decrementPendingSync(true);
      }
    })();
  };

  const moveTask = (targetStatus: Task["status"], beforeTaskId?: string) => {
    if (!project || !dragTaskId) return;
    pendingTaskDetailsProjectRef.current = null;

    const moving = project.tasks.find((task) => task.id === dragTaskId);
    if (!moving) return;

    const previousStatus = moving.status;
    const targetTasks = sortByOrder(
      project.tasks.filter(
        (task) => task.status === targetStatus && task.id !== moving.id,
      ),
    );

    if (beforeTaskId) {
      const nextIndex = targetTasks.findIndex(
        (task) => task.id === beforeTaskId,
      );
      if (nextIndex === -1) {
        moving.order = nextOrder(project.tasks, targetStatus);
      } else {
        const prev = targetTasks[nextIndex - 1];
        const next = targetTasks[nextIndex];
        const prevOrder = prev
          ? (prev.order ?? 0)
          : next
            ? (next.order ?? 0) - 1
            : 0;
        const nextOrderValue = next
          ? (next.order ?? prevOrder + 1)
          : prevOrder + 1;
        moving.order = (prevOrder + nextOrderValue) / 2;
      }
    } else {
      moving.order = nextOrder(project.tasks, targetStatus);
    }

    moving.status = targetStatus;
    rebalanceStatus(project.tasks, "backlog");
    rebalanceStatus(project.tasks, "in-progress");
    rebalanceStatus(project.tasks, "completed");
    project.updatedAt = new Date().toISOString();

    setProject({ ...project });
    setDragTaskId(null);

    if (previousStatus !== targetStatus) {
      const statusLabel = targetStatus.replace("-", " ");
      void store.addTimelineEvent({
        type: "task",
        title: moving.title,
        description: `Moved from ${previousStatus.replace("-", " ")} to ${statusLabel}`,
        projectId: project.id,
        projectName: project.name,
      });
    }

    void (async () => {
      store._internal_incrementPendingSync();
      try {
        await save(project);
        store._internal_decrementPendingSync(false);
      } catch {
        store._internal_decrementPendingSync(true);
      }
    })();
  };

  const clearDragPreview = () => {
    if (!dragPreviewRef.current) return;
    document.body.removeChild(dragPreviewRef.current);
    dragPreviewRef.current = null;
  };

  const handleTaskDragStart = (
    e: React.DragEvent<HTMLDivElement>,
    task: Task,
  ) => {
    setDragTaskId(task.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", task.id);

    const source = e.currentTarget;
    const sourceRect = source.getBoundingClientRect();
    const sourceStyles = window.getComputedStyle(source);

    const preview = source.cloneNode(true) as HTMLDivElement;
    preview.style.position = "fixed";
    preview.style.top = "-9999px";
    preview.style.left = "-9999px";
    preview.style.pointerEvents = "none";
    preview.style.width = `${sourceRect.width}px`;
    preview.style.height = `${sourceRect.height}px`;
    preview.style.margin = "0";
    preview.style.transition = "none";
    preview.style.boxShadow = "none";
    preview.style.opacity = "1";
    preview.style.filter = "none";
    preview.style.backdropFilter = "none";
    preview.style.backgroundColor = sourceStyles.backgroundColor;
    preview.style.borderColor = sourceStyles.borderColor;
    preview.style.borderStyle = sourceStyles.borderStyle;
    preview.style.borderWidth = sourceStyles.borderWidth;
    preview.style.borderRadius = sourceStyles.borderRadius;
    preview.style.color = sourceStyles.color;
    preview.style.fontSize = sourceStyles.fontSize;
    preview.style.fontWeight = sourceStyles.fontWeight;
    preview.style.lineHeight = sourceStyles.lineHeight;
    preview.style.padding = sourceStyles.padding;

    document.body.appendChild(preview);
    dragPreviewRef.current = preview;
    const offsetX = (e.nativeEvent as DragEvent).offsetX ?? 0;
    const offsetY = (e.nativeEvent as DragEvent).offsetY ?? 0;
    e.dataTransfer.setDragImage(preview, offsetX, offsetY);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-80" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 h-[calc(100vh-320px)] overflow-hidden pb-4">
          {Array.from({ length: 3 }).map((_, columnIndex) => (
            <div
              key={columnIndex}
              className="flex flex-col overflow-hidden space-y-3"
            >
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-full min-h-0 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!project)
    return <div className="text-muted-foreground">Project not found.</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          onClick={() => navigate("/projects")}
          className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <ArrowLeft className="w-4 h-4" /> Back to Dashboard
        </button>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild>
            <Button variant="ghost" size="sm">
              <Pencil className="w-4 h-4 mr-1" /> Edit Project Title
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Project Title</DialogTitle>
              <DialogDescription>
                Change the project name shown in your boards and timeline.
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <Input
                placeholder="Project title"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void renameProject()}
              />
              <Button onClick={() => void renameProject()}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <div className="ml-auto">
          <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-1" /> Add Task
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Task</DialogTitle>
                <DialogDescription>
                  Create a new task in the backlog column.
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 mt-2">
                <Input
                  placeholder="Task title"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && void addTask()}
                />
                <Button onClick={() => void addTask()}>Add</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Created on {new Date(project.createdAt).toLocaleDateString()} - Last
        updated {new Date(project.updatedAt).toLocaleDateString()}
      </p>

      <div className="mb-8 rounded-xl border border-border bg-card p-4">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Project Screenshots</h2>
            <p className="text-sm text-muted-foreground">
              Upload images for the project itself. These are separate from
              tasks.
            </p>
          </div>
          <Button variant="outline" onClick={openImageChooser}>
            <ImagePlus className="w-4 h-4 mr-2" /> Upload Screenshot
          </Button>
        </div>

        {project.screenshots.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No screenshots yet. Upload one to get started.
          </p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {project.screenshots.map((src, index) => (
              <div
                key={`${src}-${index}`}
                className="relative group overflow-hidden rounded-lg border border-border"
              >
                <img
                  src={resolveImageSrc(src)}
                  alt={`Project screenshot ${index + 1}`}
                  className="aspect-video w-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => removeProjectScreenshot(index)}
                  className="absolute right-2 top-2 rounded-full bg-background/90 p-1 text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {COLUMNS.map((col) => {
          const tasks = sortByOrder(
            project.tasks.filter((task) => task.status === col.key),
          );
          return (
            <div key={col.key}>
              <div className="flex items-center gap-2 mb-3">
                <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                <span className="font-semibold text-sm">{col.label}</span>
                <span className="text-muted-foreground text-sm">
                  ({tasks.length})
                </span>
                {col.key === "backlog" && (
                  <button
                    onClick={() => setTaskOpen(true)}
                    className="ml-auto text-muted-foreground hover:text-foreground"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div
                className="flex flex-col gap-2 min-h-[120px] bg-secondary/30 rounded-lg p-2"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => void moveTask(col.key)}
              >
                {tasks.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    No tasks
                  </p>
                )}
                {tasks.map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => handleTaskDragStart(e, task)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      e.preventDefault();
                      void moveTask(col.key, task.id);
                    }}
                    onDragEnd={() => {
                      setDragTaskId(null);
                      clearDragPreview();
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setDeleteTaskId(task.id);
                    }}
                    onClick={() => openTaskDetails(task.id)}
                    className="bg-card border border-border rounded-lg p-3 text-left text-sm hover:border-primary/40 transition-colors cursor-grab active:cursor-grabbing"
                  >
                    <p>{task.title}</p>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <Dialog
        open={taskDetailsOpen}
        onOpenChange={(open) => !open && closeTaskDetails()}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Task Details</DialogTitle>
          </DialogHeader>
          {selectedTask ? (
            <div className="flex flex-col gap-4 mt-4">
              <Input
                value={selectedTask.title}
                onChange={(e) =>
                  updateTask(selectedTask.id, { title: e.target.value })
                }
                placeholder="Task title"
              />
              <Textarea
                value={selectedTask.description ?? ""}
                onChange={(e) =>
                  updateTask(selectedTask.id, { description: e.target.value })
                }
                placeholder="Task details"
                className="min-h-[140px]"
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Task not found.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={imagePickerOpen} onOpenChange={setImagePickerOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Screenshot</DialogTitle>
            <DialogDescription>
              Choose a screenshot from file or clipboard.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <input
              ref={chooserFileRef}
              type="file"
              accept="image/*"
              onChange={(e) => void handleChooserFileChange(e)}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => chooserFileRef.current?.click()}
              className="w-full"
            >
              Choose from File
            </Button>

            {clipboardStatus === "loading" && (
              <p className="text-sm text-muted-foreground">
                Reading clipboard...
              </p>
            )}
            {clipboardStatus === "ready" && clipboardImage && (
              <Button
                variant="outline"
                onClick={() => setPendingFile(null)}
                className="w-full"
              >
                Use Clipboard Image
              </Button>
            )}
            {clipboardStatus === "empty" && (
              <p className="text-sm text-muted-foreground">
                No image in clipboard.
              </p>
            )}
            {clipboardStatus === "error" && (
              <p className="text-sm text-destructive">
                Failed to read clipboard.
              </p>
            )}

            {(pendingFilePreview ||
              (clipboardStatus === "ready" && clipboardImage)) && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Preview:</p>
                <img
                  src={pendingFilePreview || (clipboardImage ?? "")}
                  alt="Preview"
                  className="w-full h-auto rounded border border-border max-h-[300px] object-contain"
                />
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => void commitChosenImage()}
                disabled={
                  !pendingFilePreview &&
                  !(clipboardStatus === "ready" && clipboardImage)
                }
                className="flex-1"
              >
                Add Screenshot
              </Button>
              <Button
                variant="outline"
                onClick={closeImageChooser}
                className="flex-1"
              >
                Cancel
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={Boolean(deleteTaskId)}
        onOpenChange={(open) => !open && setDeleteTaskId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteTask()}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
