import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, ImagePlus } from "lucide-react";
import { store, Project, Task, getCachedProjects, resolveImageSrc } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
    screenshots: task.screenshots ?? [],
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
  const [taskName, setTaskName] = useState("");
  const [taskOpen, setTaskOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [taskDetailsOpen, setTaskDetailsOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [imagePickerTarget, setImagePickerTarget] = useState<"project" | "task" | null>(null);
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">(
    "idle",
  );
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [pendingFilePreview, setPendingFilePreview] = useState<string | null>(null);
  const chooserFileRef = useRef<HTMLInputElement>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const projects = await store.getProjects();
      const current = normalizeProject(projects.find((item) => item.id === id) ?? null);
      if (!active) return;

      if (!current) {
        setProject(null);
        return;
      }

      setProject(current);
      setEditName(current.name);

      const source = projects.find((item) => item.id === id) ?? null;
      const needsSave = source?.tasks.some(
        (task, index) =>
          task.description === undefined ||
          task.screenshots === undefined ||
          task.order === undefined ||
          task.order !== current.tasks[index].order,
      ) ?? false;

      if (needsSave) {
        const all = projects.map((item) =>
          item.id === current.id ? current : item,
        );
        await store.saveProjects(all);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, [id]);

  useStoreSubscription(["projects"], () => {
    // Skip subscription update while dragging to prevent reverting changes
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
      screenshots: [],
      order: nextOrder(project.tasks, "backlog"),
    };
    project.tasks.push(task);
    project.updatedAt = new Date().toISOString();

    // Update UI immediately
    setProject({ ...project });
    setTaskName("");
    setTaskOpen(false);

    // Sync in background
    void (async () => {
      store._internal_incrementPendingSync();
      try {
        const all = (await store.getProjects()).map((item) =>
          item.id === project.id ? project : item,
        );
        await store.saveProjects(all);
        await store.addTimelineEvent({
          type: "task",
          title: task.title,
          description: `Added to ${project.name}`,
          projectId: project.id,
          projectName: project.name,
        });
        store._internal_decrementPendingSync(false);
      } catch (error) {
        console.error("Failed to sync task:", error);
        store._internal_decrementPendingSync(true);
      }
    })();
  };

  const renameProject = () => {
    if (!project || !editName.trim()) return;
    project.name = editName.trim();
    project.updatedAt = new Date().toISOString();
    
    // Update UI immediately
    setProject({ ...project });
    setEditOpen(false);

    // Sync in background
    void (async () => {
      store._internal_incrementPendingSync();
      try {
        await save(project);
        store._internal_decrementPendingSync(false);
      } catch (error) {
        console.error("Failed to sync project name:", error);
        store._internal_decrementPendingSync(true);
      }
    })();
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
        const dataUrl = await readFileAsDataUrl(new File([blob], "clipboard-image", { type: blob.type }));
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

  const openImageChooser = (target: "project" | "task") => {
    setImagePickerTarget(target);
    setPendingFile(null);
    setPendingFilePreview(null);
    setClipboardImage(null);
    setClipboardStatus("idle");
    setImagePickerOpen(true);
    void readClipboardImage();
  };

  const closeImageChooser = () => {
    setImagePickerOpen(false);
    setImagePickerTarget(null);
    setPendingFile(null);
    setPendingFilePreview(null);
    setClipboardImage(null);
    setClipboardStatus("idle");
  };

  const handleChooserFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPendingFile(file);
    if (file) {
      setPendingFilePreview(await readFileAsDataUrl(file));
    } else {
      setPendingFilePreview(null);
    }
  };

  const commitChosenImage = () => {
    if (!imagePickerTarget) return;

    void (async () => {
      const source = pendingFile ?? (clipboardImage ? new File([await (await fetch(clipboardImage)).blob()], "clipboard-image") : null);
      if (!source) return;

      if (imagePickerTarget === "project") {
        await addProjectScreenshot(source);
      } else {
        if (!selectedTaskId) return;
        await addTaskScreenshot(source, selectedTaskId);
      }

      closeImageChooser();
    })();
  };

  const addProjectScreenshot = async (file: File) => {
    if (!project) return;
    const data = await readFileAsDataUrl(file);
    project.screenshots.push(data);
    project.updatedAt = new Date().toISOString();
    
    // Update UI immediately
    setProject({ ...project });

    // Sync in background
    store._internal_incrementPendingSync();
    try {
      await save(project);
      await store.addTimelineEvent({ type: "log", title: "Screenshot uploaded", description: "", projectId: project.id, projectName: project.name, image: data });
      store._internal_decrementPendingSync(false);
    } catch (error) {
      console.error("Failed to sync screenshot:", error);
      store._internal_decrementPendingSync(true);
    }
  };

  const addTaskScreenshot = async (file: File, taskId: string) => {
    if (!project) return;
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) return;
    const data = await readFileAsDataUrl(file);
    task.screenshots = [...(task.screenshots ?? []), data];
    project.updatedAt = new Date().toISOString();
    
    // Update UI immediately
    setProject({ ...project });

    // Sync in background
    store._internal_incrementPendingSync();
    try {
      await save(project);
      store._internal_decrementPendingSync(false);
    } catch (error) {
      console.error("Failed to sync task screenshot:", error);
      store._internal_decrementPendingSync(true);
    }
  };

  const getClipboardImageFiles = (clipboardData: DataTransfer | null) => {
    if (!clipboardData) return [] as File[];
    return Array.from(clipboardData.items)
      .filter((item) => item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));
  };

  const uploadScreenshot = () => {
    openImageChooser("project");
  };

  const handleProjectPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const files = getClipboardImageFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void (async () => {
      for (const file of files) {
        await addProjectScreenshot(file);
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

  const updateTask = (taskId: string, updates: Partial<Task>) => {
    if (!project) return;
    const task = project.tasks.find((item) => item.id === taskId);
    if (!task) return;
    Object.assign(task, updates);
    project.updatedAt = new Date().toISOString();
    void save(project);
  };

  const uploadTaskScreenshot = () => {
    openImageChooser("task");
  };

  const handleTaskPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (!selectedTaskId) return;
    const files = getClipboardImageFiles(e.clipboardData);
    if (files.length === 0) return;
    e.preventDefault();
    void (async () => {
      for (const file of files) {
        await addTaskScreenshot(file, selectedTaskId);
      }
    })();
  };

  const confirmDeleteTask = () => {
    if (!project || !deleteTaskId) return;
    const task = project.tasks.find((item) => item.id === deleteTaskId);
    project.tasks = project.tasks.filter((item) => item.id !== deleteTaskId);
    rebalanceStatus(project.tasks, "backlog");
    rebalanceStatus(project.tasks, "in-progress");
    rebalanceStatus(project.tasks, "completed");
    project.updatedAt = new Date().toISOString();
    
    // Update UI immediately
    setProject({ ...project });
    setDeleteTaskId(null);

    // Sync in background
    void (async () => {
      store._internal_incrementPendingSync();
      try {
        await save(project);
        if (task) {
          await store.addTimelineEvent({
            type: "task",
            title: `Task deleted: ${task.title}`,
            description: "",
            projectId: project.id,
            projectName: project.name,
          });
        }
        store._internal_decrementPendingSync(false);
      } catch (error) {
        console.error("Failed to delete task:", error);
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

    // Update UI immediately
    setProject({ ...project });
    setDragTaskId(null);

    // Fire off backend updates without waiting
    void (async () => {
      store._internal_incrementPendingSync();
      try {
        await save(project);

        // Create timeline event for task status change
        if (previousStatus !== targetStatus) {
          const statusLabel = targetStatus.replace("-", " ");
          await store.addTimelineEvent({
            type: "task",
            title: `${moving.title}`,
            description: `Moved from ${previousStatus.replace("-", " ")} to ${statusLabel}`,
            projectId: project.id,
            projectName: project.name,
          });
        }
        store._internal_decrementPendingSync(false);
      } catch (error) {
        console.error("Failed to move task:", error);
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

    const preview = document.createElement("div");
    preview.style.position = "fixed";
    preview.style.top = "-9999px";
    preview.style.left = "-9999px";
    preview.style.pointerEvents = "none";
    preview.style.width = "280px";
    preview.style.borderRadius = "12px";
    preview.style.padding = "12px 14px";
    preview.style.color = "hsl(240 15% 92%)";
    preview.style.background = "rgba(45, 52, 78, 0.94)";
    preview.style.border = "1px solid rgba(255, 255, 255, 0.22)";
    preview.style.boxShadow = "0 14px 30px rgba(6, 12, 24, 0.45), inset 0 1px 0 rgba(255, 255, 255, 0.16)";
    preview.style.backdropFilter = "blur(8px)";
    preview.style.fontSize = "14px";
    preview.style.fontWeight = "600";
    preview.style.lineHeight = "1.3";
    preview.textContent = task.title;

    document.body.appendChild(preview);
    dragPreviewRef.current = preview;
    e.dataTransfer.setDragImage(preview, 20, 20);
  };

  if (!project) return <div className="text-muted-foreground">Project not found.</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => navigate("/projects")} className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"><ArrowLeft className="w-4 h-4" /> Back to Dashboard</button>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild><Button variant="ghost" size="sm"><Pencil className="w-4 h-4 mr-1" /> Edit Project Title</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Project Title</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <Input placeholder="Project title" value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === "Enter" && void renameProject()} />
              <Button onClick={() => void renameProject()}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4 mb-1 flex-wrap" onPaste={handleProjectPaste}>
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <div className="flex gap-2 ml-auto">
          <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> Add Task</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
              <div className="flex flex-col gap-4 mt-2">
                <Input placeholder="Task title" value={taskName} onChange={e => setTaskName(e.target.value)} onKeyDown={e => e.key === "Enter" && void addTask()} />
                <Button onClick={() => void addTask()}>Add</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={uploadScreenshot}><ImagePlus className="w-4 h-4 mr-1" /> Upload Screenshot</Button>
        </div>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        📅 Created on {new Date(project.createdAt).toLocaleDateString()} • Last updated {new Date(project.updatedAt).toLocaleDateString()}
      </p>

      <Tabs defaultValue="tasks">
        <TabsList className="bg-secondary mb-6">
          <TabsTrigger value="tasks">⫸ Tasks</TabsTrigger>
          <TabsTrigger value="gallery">🖼 Gallery</TabsTrigger>
        </TabsList>
        <TabsContent value="tasks">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {COLUMNS.map(col => {
              const tasks = sortByOrder(project.tasks.filter((task) => task.status === col.key));
              return (
                <div key={col.key}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className={`w-2.5 h-2.5 rounded-full ${col.color}`} />
                    <span className="font-semibold text-sm">{col.label}</span>
                    <span className="text-muted-foreground text-sm">({tasks.length})</span>
                    {col.key === "backlog" && (
                      <button onClick={() => setTaskOpen(true)} className="ml-auto text-muted-foreground hover:text-foreground"><Plus className="w-4 h-4" /></button>
                    )}
                  </div>
                  <div
                    className="flex flex-col gap-2 min-h-[120px] bg-secondary/30 rounded-lg p-2"
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
        </TabsContent>
        <TabsContent value="gallery">
          {project.screenshots.length === 0 ? (
            <p className="text-muted-foreground text-sm">No screenshots yet. Upload some!</p>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              {project.screenshots.map((src, i) => (
                <img key={i} src={resolveImageSrc(src)} alt={`Screenshot ${i + 1}`} className="rounded-lg border border-border object-cover w-full aspect-video" />
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={taskDetailsOpen} onOpenChange={setTaskDetailsOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Task Details</DialogTitle>
          </DialogHeader>
          {selectedTask ? (
            <div className="flex flex-col gap-4 mt-2" onPaste={handleTaskPaste}>
              <Input
                value={selectedTask.title}
                onChange={(e) => updateTask(selectedTask.id, { title: e.target.value })}
                placeholder="Task title"
              />
              <Textarea
                value={selectedTask.description ?? ""}
                onChange={(e) => updateTask(selectedTask.id, { description: e.target.value })}
                placeholder="Task details"
                className="min-h-[140px]"
              />
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={uploadTaskScreenshot}>
                  <ImagePlus className="w-4 h-4 mr-2" /> Add Screenshot
                </Button>
              </div>
              
              {(selectedTask.screenshots ?? []).length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {(selectedTask.screenshots ?? []).map((src, index) => (
                    <img key={index} src={resolveImageSrc(src)} alt={`Task screenshot ${index + 1}`} className="rounded-md border border-border aspect-video object-cover w-full" />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Task not found.</p>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={imagePickerOpen} onOpenChange={(open) => (open ? setImagePickerOpen(true) : closeImageChooser())}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{imagePickerTarget === "task" ? "Add task screenshot" : "Upload screenshot"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-secondary/30 p-3">
              <p className="mb-2 text-sm font-medium">Clipboard</p>
              {clipboardStatus === "loading" && <p className="text-sm text-muted-foreground">Checking clipboard...</p>}
              {clipboardStatus === "empty" && <p className="text-sm text-muted-foreground">No image in clipboard.</p>}
              {clipboardStatus === "error" && <p className="text-sm text-muted-foreground">Clipboard access is unavailable. Use file upload instead.</p>}
              {clipboardStatus === "ready" && clipboardImage && (
                <img src={resolveImageSrc(clipboardImage)} alt="Clipboard preview" className="max-h-56 w-full rounded-md border border-border object-contain" />
              )}
            </div>

            <div className="rounded-lg border border-dashed border-border p-3">
              <p className="mb-2 text-sm font-medium">File explorer</p>
              <input
                ref={chooserFileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handleChooserFileChange}
              />
              <Button type="button" variant="outline" className="w-full" onClick={() => chooserFileRef.current?.click()}>
                Choose image from computer
              </Button>
              {pendingFilePreview && (
                <img src={resolveImageSrc(pendingFilePreview)} alt="Selected file preview" className="mt-3 max-h-56 w-full rounded-md border border-border object-contain" />
              )}
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={closeImageChooser}>
                Cancel
              </Button>
              <Button type="button" onClick={() => void commitChosenImage()} disabled={!pendingFile && !clipboardImage}>
                Use image
              </Button>
            </div>
          </div>
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
