import { useMemo, useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, ImagePlus } from "lucide-react";
import { store, Project, Task } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  const fileRef = useRef<HTMLInputElement>(null);
  const taskFileRef = useRef<HTMLInputElement>(null);
  const dragPreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const p = store.getProjects().find((item) => item.id === id) ?? null;
    if (!p) {
      setProject(null);
      return;
    }

    const normalizedTasks = p.tasks.map((task, index) => ({
      ...task,
      description: task.description ?? "",
      screenshots: task.screenshots ?? [],
      order: typeof task.order === "number" ? task.order : index,
    }));

    const normalizedProject: Project = { ...p, tasks: normalizedTasks };
    setProject(normalizedProject);
    setEditName(normalizedProject.name);

    const needsSave = p.tasks.some((task, index) =>
      task.description === undefined || task.screenshots === undefined || task.order === undefined || task.order !== normalizedTasks[index].order,
    );

    if (needsSave) {
      const all = store.getProjects().map((item) => (item.id === normalizedProject.id ? normalizedProject : item));
      store.saveProjects(all);
    }
  }, [id]);

  const save = (updatedProject: Project) => {
    const all = store.getProjects().map((item) => (item.id === updatedProject.id ? updatedProject : item));
    store.saveProjects(all);
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
    save(project);
    store.addTimelineEvent({ type: "task", title: task.title, description: `Added to ${project.name}`, projectName: project.name });
    setTaskName("");
    setTaskOpen(false);
  };

  const renameProject = () => {
    if (!project || !editName.trim()) return;
    project.name = editName.trim();
    project.updatedAt = new Date().toISOString();
    save(project);
    setEditOpen(false);
  };

  const uploadScreenshot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project) return;
    const reader = new FileReader();
    reader.onload = () => {
      const data = reader.result as string;
      project.screenshots.push(data);
      project.updatedAt = new Date().toISOString();
      save(project);
      store.addTimelineEvent({ type: "log", title: "Screenshot uploaded", description: "", projectName: project.name, image: data });
    };
    reader.readAsDataURL(file);
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
    save(project);
  };

  const uploadTaskScreenshot = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !project || !selectedTaskId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const task = project.tasks.find((item) => item.id === selectedTaskId);
      if (!task) return;
      const data = reader.result as string;
      task.screenshots = [...(task.screenshots ?? []), data];
      project.updatedAt = new Date().toISOString();
      save(project);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  };

  const confirmDeleteTask = () => {
    if (!project || !deleteTaskId) return;
    const task = project.tasks.find((item) => item.id === deleteTaskId);
    project.tasks = project.tasks.filter((item) => item.id !== deleteTaskId);
    rebalanceStatus(project.tasks, "backlog");
    rebalanceStatus(project.tasks, "in-progress");
    rebalanceStatus(project.tasks, "completed");
    project.updatedAt = new Date().toISOString();
    save(project);
    if (task) {
      store.addTimelineEvent({ type: "task", title: `Task deleted: ${task.title}`, description: "", projectName: project.name });
    }
    setDeleteTaskId(null);
  };

  const moveTask = (targetStatus: Task["status"], beforeTaskId?: string) => {
    if (!project || !dragTaskId) return;

    const moving = project.tasks.find((task) => task.id === dragTaskId);
    if (!moving) return;

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
    save(project);
    setDragTaskId(null);
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
          <DialogTrigger asChild><Button variant="ghost" size="sm"><Pencil className="w-4 h-4 mr-1" /> Edit Project</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit Project</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <Input value={editName} onChange={e => setEditName(e.target.value)} onKeyDown={e => e.key === "Enter" && renameProject()} />
              <Button onClick={renameProject}>Save</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="flex items-center gap-4 mb-1 flex-wrap">
        <h1 className="text-3xl font-bold">{project.name}</h1>
        <div className="flex gap-2 ml-auto">
          <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
            <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-1" /> Add Task</Button></DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle>Add Task</DialogTitle></DialogHeader>
              <div className="flex flex-col gap-4 mt-2">
                <Input placeholder="Task title" value={taskName} onChange={e => setTaskName(e.target.value)} onKeyDown={e => e.key === "Enter" && addTask()} />
                <Button onClick={addTask}>Add</Button>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" onClick={() => fileRef.current?.click()}><ImagePlus className="w-4 h-4 mr-1" /> Upload Screenshot</Button>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={uploadScreenshot} />
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
                    onDrop={() => moveTask(col.key)}
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
                          moveTask(col.key, task.id);
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
                <img key={i} src={src} alt={`Screenshot ${i + 1}`} className="rounded-lg border border-border object-cover w-full aspect-video" />
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
            <div className="flex flex-col gap-4 mt-2">
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
                <Button type="button" variant="outline" onClick={() => taskFileRef.current?.click()}>
                  <ImagePlus className="w-4 h-4 mr-2" /> Add Screenshot
                </Button>
                <input
                  ref={taskFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={uploadTaskScreenshot}
                />
              </div>

              {(selectedTask.screenshots ?? []).length > 0 && (
                <div className="grid grid-cols-2 gap-2">
                  {(selectedTask.screenshots ?? []).map((src, index) => (
                    <img key={index} src={src} alt={`Task screenshot ${index + 1}`} className="rounded-md border border-border aspect-video object-cover w-full" />
                  ))}
                </div>
              )}
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
            <AlertDialogAction onClick={confirmDeleteTask}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
