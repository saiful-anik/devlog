import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, ImagePlus, X, Image } from "lucide-react";
import { store, Project, Task, getCachedProjects, resolveImageSrc, getScreenshotSizeLimit, formatBytes, ProjectScreenshot } from "@/lib/store";
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
import { ScreenshotUploadDialog } from "@/components/ScreenshotUploadDialog";
import { supabase } from "@/lib/supabase";
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
import { toast } from "sonner";

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
    reference: task.reference ?? "",
    order: typeof task.order === "number" ? task.order : index,
  }));

  return {
    ...project,
    tasks: normalizedTasks,
  };
}

export default function ProjectDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [screenshots, setScreenshots] = useState<ProjectScreenshot[]>([]);
  const [activeSection, setActiveSection] = useState<"tasks" | "screenshots">("tasks");
  const [selectedScreenshot, setSelectedScreenshot] = useState<ProjectScreenshot | null>(null);
  const [taskName, setTaskName] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDraft, setTaskDraft] = useState<{ title: string; description: string; reference: string } | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);
  const screenshotInputRef = useRef<HTMLInputElement | null>(null);

  const readFileAsDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(new Error("Failed to read screenshot"));
      reader.readAsDataURL(file);
    });

  const readClipboardImage = async () => {
    if (!navigator.clipboard?.read) {
      setClipboardStatus("empty");
      return;
    }

    try {
      setClipboardStatus("loading");
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;

        const blob = await item.getType(imageType);
        const maxSize = await getScreenshotSizeLimit();
        if (blob.size > maxSize) {
          toast.error(`Clipboard image too large (${formatBytes(blob.size)}). Max ${formatBytes(maxSize)} allowed.`);
          setClipboardStatus("error");
          return;
        }

        const dataUrl = await readFileAsDataUrl(new File([blob], "clipboard-image", { type: blob.type }));
        setTaskDraft((prev) => {
          if (!prev) return prev;
          if (prev.reference) return prev;
          return {
            ...prev,
            reference: dataUrl,
          };
        });
        setClipboardStatus("ready");
        return;
      }

      setClipboardStatus("empty");
    } catch {
      setClipboardStatus("error");
    }
  };

  const handleScreenshotChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;

    const maxSize = await getScreenshotSizeLimit();
    if (file.size > maxSize) {
      toast.error(`File too large (${formatBytes(file.size)}). Max ${formatBytes(maxSize)} allowed.`);
      event.target.value = "";
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setTaskDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        reference: dataUrl,
      };
    });
    setClipboardStatus("idle");
  };

  useEffect(() => {
    let active = true;

    const load = async () => {
      const projects = await store.getProjects();
      const current = normalizeProject(projects.find((item) => item.id === id) ?? null);
      if (!active) return;

      if (!current) {
        setProject(null);
        setIsLoading(false);
        return;
      }

      setProject(current);
      setEditName(current.name);

      // Fetch project screenshots
      if (supabase && id) {
        try {
          const { data } = await supabase
            .from("project_screenshots")
            .select("*")
            .eq("project_id", id)
            .order("created_at", { ascending: false });
          
          if (active && data) {
            setScreenshots(data as ProjectScreenshot[]);
          }
        } catch (error) {
          console.error("Failed to fetch screenshots:", error);
        }
      }

      setIsLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, [id]);

  useStoreSubscription(["projects"], () => {
    if (dragTaskId) return;

    const current = normalizeProject(getCachedProjects().find((item) => item.id === id) ?? null);
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

  const sortByOrder = (tasks: Task[]) => [...tasks].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  const rebalanceStatus = (tasks: Task[], status: Task["status"]) => {
    sortByOrder(tasks.filter((task) => task.status === status)).forEach((task, index) => {
      task.order = index;
    });
  };

  const nextOrder = (tasks: Task[], status: Task["status"]) => {
    const inColumn = sortByOrder(tasks.filter((task) => task.status === status));
    if (inColumn.length === 0) return 0;
    return (inColumn[inColumn.length - 1].order ?? 0) + 1;
  };

  const addTask = () => {
    if (!project || !taskName.trim()) return;
    const task: Task = {
      id: store.uid(),
      title: taskName.trim(),
      status: "backlog",
      createdAt: new Date().toISOString(),
      description: "",
      reference: "",
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
    if (!project) return;
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) return;

    setSelectedTaskId(taskId);
    setTaskDraft({
      title: task.title,
      description: task.description ?? "",
      reference: task.reference ?? "",
    });
    setClipboardStatus("idle");
    setTaskDetailsOpen(true);
    void readClipboardImage();
  };

  const closeTaskDetails = () => {
    setTaskDetailsOpen(false);
    setSelectedTaskId(null);
    setTaskDraft(null);
    setClipboardStatus("idle");
    if (screenshotInputRef.current) screenshotInputRef.current.value = "";
  };

  const saveTaskDetails = () => {
    if (project && selectedTaskId && taskDraft) {
      const task = project.tasks.find((item) => item.id === selectedTaskId);

      if (task) {
        const hasChanges =
          task.title !== taskDraft.title ||
          (task.description ?? "") !== taskDraft.description ||
          (task.reference ?? "") !== taskDraft.reference;

        if (hasChanges) {
          task.title = taskDraft.title;
          task.description = taskDraft.description;
          task.reference = taskDraft.reference;
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
        }
      }
    }

    closeTaskDetails();
  };

  const handleTaskDetailsOpenChange = (open: boolean) => {
    if (open) {
      setTaskDetailsOpen(true);
      return;
    }

    closeTaskDetails();
  };

  const confirmDeleteTask = () => {
    if (!project || !deleteTaskId) return;

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

    const moving = project.tasks.find((task) => task.id === dragTaskId);
    if (!moving) return;

    const previousStatus = moving.status;
    const targetTasks = sortByOrder(
      project.tasks.filter((task) => task.status === targetStatus && task.id !== moving.id),
    );

    if (beforeTaskId) {
      const nextIndex = targetTasks.findIndex((task) => task.id === beforeTaskId);
      if (nextIndex === -1) {
        moving.order = nextOrder(project.tasks, targetStatus);
      } else {
        const prev = targetTasks[nextIndex - 1];
        const next = targetTasks[nextIndex];
        const prevOrder = prev ? (prev.order ?? 0) : (next ? (next.order ?? 0) - 1 : 0);
        const nextOrderValue = next ? (next.order ?? prevOrder + 1) : prevOrder + 1;
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

  const handleTaskDragStart = (e: React.DragEvent<HTMLDivElement>, task: Task) => {
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
            <div key={columnIndex} className="flex flex-col overflow-hidden space-y-3">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-full min-h-0 rounded-lg" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!project) return <div className="text-muted-foreground">Project not found.</div>;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => navigate("/projects")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to Dashboard</button>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild><Button variant="ghost" size="sm"><Pencil className="w-4 h-4 mr-1" /> Edit Project Title</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Edit Project Title</DialogTitle>
              <DialogDescription>Change the project name shown in your boards and timeline.</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <Input placeholder="Project title" value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === "Enter" && void renameProject()} />
              <Button onClick={() => void renameProject()}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <div className="ml-auto flex items-center gap-2">
          <ScreenshotUploadDialog 
            projectId={project.id} 
            projectName={project.name}
            onUploadSuccess={async () => {
              // Refresh screenshots after upload
              if (supabase && id) {
                const { data } = await supabase
                  .from("project_screenshots")
                  .select("*")
                  .eq("project_id", id)
                  .order("created_at", { ascending: false });
                
                if (data) {
                  setScreenshots(data as ProjectScreenshot[]);
                  toast.success("Screenshot uploaded successfully!");
                }
              }
            }}
          />
          <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> Add Task</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Task</DialogTitle>
                <DialogDescription>Create a new task in the backlog column.</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col gap-4 mt-2">
                <Input placeholder="Task title" value={taskName} onChange={e => setTaskName(e.target.value)} onKeyDown={e => e.key === "Enter" && void addTask()} />
                <Button onClick={() => void addTask()}>Add</Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <p className="text-sm text-muted-foreground mb-6">
        Created on {new Date(project.createdAt).toLocaleDateString()} - Last updated {new Date(project.updatedAt).toLocaleDateString()}
      </p>

      {/* Section Tabs */}
      <div className="flex gap-2 mb-6 border-b border-border">
        <button
          onClick={() => setActiveSection("tasks")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeSection === "tasks"
              ? "text-foreground border-b-2 border-primary -mb-[2px]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Tasks
        </button>
        <button
          onClick={() => setActiveSection("screenshots")}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeSection === "screenshots"
              ? "text-foreground border-b-2 border-primary -mb-[2px]"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Screenshots ({screenshots.length})
        </button>
      </div>

      {/* Tasks Section */}
      {activeSection === "tasks" && (
        <div className="grid flex-1 min-h-0 grid-cols-1 gap-4 overflow-hidden pb-4 md:grid-cols-3">
          {COLUMNS.map(col => {
            const tasks = sortByOrder(project.tasks.filter((task) => task.status === col.key));
            return (
              <div key={col.key} className="flex min-h-0 flex-col">
                <div className="flex items-center gap-2 mb-3">
                  <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                  <span className="font-semibold text-sm">{col.label}</span>
                  <span className="text-muted-foreground text-sm">({tasks.length})</span>
                  {col.key === "backlog" && (
                    <button onClick={() => setTaskOpen(true)} className="ml-auto text-muted-foreground hover:text-foreground"><Plus className="w-4 h-4" /></button>
                  )}
                </div>
                <div
                  className="flex flex-1 min-h-0 flex-col gap-2 overflow-y-auto bg-secondary/30 rounded-lg p-2"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => void moveTask(col.key)}
                >
                  {tasks.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No tasks</p>}
                  {tasks.map(task => (
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
      )}

      {/* Screenshots Section */}
      {activeSection === "screenshots" && (
        <div>
          {screenshots.length === 0 ? (
            <p className="text-sm text-muted-foreground">No screenshots yet. Upload one to get started.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
              {screenshots.map((screenshot) => (
                <button
                  key={screenshot.id}
                  onClick={() => setSelectedScreenshot(screenshot)}
                  className="group relative overflow-hidden rounded-lg cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 dark:focus:ring-offset-slate-950 aspect-square"
                >
                  <img
                    src={resolveImageSrc(screenshot.file_path)}
                    alt={screenshot.caption || "Screenshot"}
                    className="w-full h-full object-cover group-hover:brightness-75 transition-all duration-200"
                  />
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Fullscreen Preview Modal */}
      {selectedScreenshot && (
        <Dialog open={!!selectedScreenshot} onOpenChange={(open) => !open && setSelectedScreenshot(null)}>
          <DialogContent className="max-w-4xl max-h-[90vh] p-0 bg-black/95 border-0">
            <div className="relative w-full h-full flex items-center justify-center">
              <img
                src={resolveImageSrc(selectedScreenshot.file_path)}
                alt={selectedScreenshot.caption || "Screenshot"}
                className="max-w-full max-h-[85vh] object-cover"
              />
              {selectedScreenshot.caption && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-4 text-white text-sm">
                  {selectedScreenshot.caption}
                </div>
              )}
            </div>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={taskDetailsOpen} onOpenChange={handleTaskDetailsOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Task Details</DialogTitle>
            <DialogDescription>Update task title, details, and add an optional screenshot.</DialogDescription>
          </DialogHeader>
          {selectedTask ? (
            <div className="flex flex-col gap-4 mt-2">
              <Input
                value={taskDraft?.title ?? selectedTask.title}
                onChange={(e) =>
                  setTaskDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          title: e.target.value,
                        }
                      : prev,
                  )
                }
                placeholder="Task title"
              />
              <Textarea
                value={taskDraft?.description ?? selectedTask.description ?? ""}
                onChange={(e) =>
                  setTaskDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          description: e.target.value,
                        }
                      : prev,
                  )
                }
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    closeTaskDetails();
                    return;
                  }

                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    saveTaskDetails();
                  }
                }}
                placeholder="Task details"
                className="min-h-[140px]"
              />

              <input
                ref={screenshotInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void handleScreenshotChange(e)}
              />
              <div className="rounded-md border border-border p-3">
                <p className="mb-2 text-sm font-medium">Screenshot</p>
                {clipboardStatus === "loading" && <p className="text-xs text-muted-foreground">Checking clipboard...</p>}
                {clipboardStatus === "empty" && <p className="text-xs text-muted-foreground">No image found in clipboard.</p>}
                {clipboardStatus === "error" && <p className="text-xs text-muted-foreground">Clipboard access unavailable. Use file upload.</p>}
                {clipboardStatus === "ready" && !taskDraft?.reference && (
                  <p className="text-xs text-muted-foreground">Image found in clipboard.</p>
                )}

                {taskDraft?.reference && (
                  <div className="relative mt-2 inline-block">
                    <img
                      src={resolveImageSrc(taskDraft.reference)}
                      alt="Task screenshot preview"
                      className="max-h-40 rounded-md border border-border"
                    />
                    <button
                      type="button"
                      className="absolute right-2 top-2 rounded-full bg-background/85 p-1 text-foreground shadow"
                      onClick={() =>
                        setTaskDraft((prev) =>
                          prev
                            ? {
                                ...prev,
                                reference: "",
                              }
                            : prev,
                        )
                      }
                      aria-label="Remove screenshot"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}

                <Button type="button" variant="outline" className="mt-3" onClick={() => screenshotInputRef.current?.click()}>
                  <ImagePlus className="mr-2 h-4 w-4" /> Choose screenshot
                </Button>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={closeTaskDetails}>Cancel</Button>
                <Button onClick={saveTaskDetails}>Save</Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Task not found.</p>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleteTaskId)} onOpenChange={(open) => !open && setDeleteTaskId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmDeleteTask()}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
