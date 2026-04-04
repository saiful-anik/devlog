import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Plus, Pencil, ImagePlus } from "lucide-react";
import { store, Project, Task } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const p = store.getProjects().find(p => p.id === id) ?? null;
    setProject(p);
    if (p) setEditName(p.name);
  }, [id]);

  const save = (p: Project) => {
    const all = store.getProjects().map(x => x.id === p.id ? p : x);
    store.saveProjects(all);
    setProject({ ...p });
  };

  const addTask = () => {
    if (!project || !taskName.trim()) return;
    const task: Task = { id: store.uid(), title: taskName.trim(), status: "backlog", createdAt: new Date().toISOString() };
    project.tasks.push(task);
    project.updatedAt = new Date().toISOString();
    save(project);
    store.addTimelineEvent({ type: "task", title: task.title, description: `Added to ${project.name}`, projectName: project.name });
    setTaskName("");
    setTaskOpen(false);
  };

  const cycleStatus = (taskId: string) => {
    if (!project) return;
    const task = project.tasks.find(t => t.id === taskId);
    if (!task) return;
    const order: Task["status"][] = ["backlog", "in-progress", "completed"];
    task.status = order[(order.indexOf(task.status) + 1) % 3];
    project.updatedAt = new Date().toISOString();
    save(project);
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
              const tasks = project.tasks.filter(t => t.status === col.key);
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
                  <div className="flex flex-col gap-2 min-h-[120px] bg-secondary/30 rounded-lg p-2">
                    {tasks.length === 0 && <p className="text-xs text-muted-foreground text-center py-6">No tasks</p>}
                    {tasks.map(task => (
                      <button key={task.id} onClick={() => cycleStatus(task.id)} className="bg-card border border-border rounded-lg p-3 text-left text-sm hover:border-primary/40 transition-colors">
                        {task.title}
                      </button>
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
    </div>
  );
}
