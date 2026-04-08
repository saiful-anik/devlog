import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, FolderKanban } from "lucide-react";
import { store, Project, getCachedProjects } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const load = async () => {
      const projectsData = await store.getProjects();
      if (active) setProjects(projectsData);
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  useStoreSubscription(["projects"], () => {
    setProjects(getCachedProjects());
  });

  const createProject = async () => {
    if (!newName.trim()) return;
    const now = new Date().toISOString();
    const project: Project = { id: store.uid(), name: newName.trim(), tasks: [], screenshots: [], createdAt: now, updatedAt: now };
    const updated = [...projects, project];
    await store.saveProjects(updated);
    setProjects(updated);
    await store.addTimelineEvent({ type: "project", title: `Project "${project.name}" created.`, description: "", projectId: project.id, projectName: project.name });
    setNewName("");
    setOpen(false);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Projects</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> New Project</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create New Project</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <Input placeholder="Project title" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && void createProject()} />
              <Button onClick={() => void createProject()}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {projects.map(p => {
          const completed = p.tasks.filter(t => t.status === "completed").length;
          const total = p.tasks.length;
          const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
          return (
            <button key={p.id} onClick={() => navigate(`/projects/${p.id}`)} className="border border-border rounded-xl p-5 bg-card text-left hover:border-primary/50 transition-colors">
              <div className="flex items-center gap-2 mb-3">
                <FolderKanban className="w-5 h-5 text-primary" />
                <h3 className="font-semibold truncate">{p.name}</h3>
              </div>
              <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden mb-2">
                <div className="h-full bg-primary rounded-full" style={{ width: `${pct}%` }} />
              </div>
              <p className="text-xs text-muted-foreground">{completed}/{total} tasks • {new Date(p.updatedAt).toLocaleDateString()}</p>
            </button>
          );
        })}
        {projects.length === 0 && (
          <button onClick={() => setOpen(true)} className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center gap-3 hover:border-primary/50 transition-colors col-span-full max-w-md">
            <Plus className="w-6 h-6 text-muted-foreground" />
            <span className="text-muted-foreground">Create your first project</span>
          </button>
        )}
      </div>
    </div>
  );
}
