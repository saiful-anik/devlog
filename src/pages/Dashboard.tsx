import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Plus } from "lucide-react";
import { store, Project, TimelineEvent, getCachedProjects, getCachedTimeline } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";

export default function Dashboard() {
  const [projects, setProjects] = useState<Project[]>(getCachedProjects());
  const [timeline, setTimeline] = useState<TimelineEvent[]>(getCachedTimeline());
  const [newName, setNewName] = useState("");
  const [open, setOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const load = async () => {
      const [projectsData, timelineData] = await Promise.all([
        store.getProjects(),
        store.getTimeline(),
      ]);

      if (!active) return;
      setProjects(projectsData);
      setTimeline(timelineData);
      setIsLoading(false);
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  useStoreSubscription(["projects", "timeline"], () => {
    setProjects(getCachedProjects());
    setTimeline(getCachedTimeline());
  });

  const recentActivity = timeline.slice(0, 5);

  const createProject = async () => {
    if (!newName.trim()) return;
    const now = new Date().toISOString();
    const project: Project = {
      id: store.uid(),
      name: newName.trim(),
      tasks: [],
      screenshots: [],
      createdAt: now,
      updatedAt: now,
    };
    const updated = [...projects, project];
    setProjects(updated);

    await store.saveProjects(updated);
    void store.addTimelineEvent({
      type: "project",
      title: `Project "${project.name}" created.`,
      description: "",
      projectId: project.id,
      projectName: project.name,
    });
    setNewName("");
    setOpen(false);
  };

  const firstProject = projects[0];
  const completedTasks = firstProject?.tasks.filter(t => t.status === "completed").length ?? 0;
  const totalTasks = firstProject?.tasks.length ?? 0;
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
  const latestBacklog = firstProject?.tasks.filter(t => t.status === "backlog").slice(-1)[0];

  const statusColor = (type: string) => {
    if (type === "task") return "bg-info";
    if (type === "project") return "bg-success";
    return "bg-primary";
  };

  return (
    <div>
      {isLoading ? (
        <div className="space-y-8">
          <Skeleton className="h-9 w-48" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="border border-border rounded-xl p-6 bg-card space-y-4">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-8 w-32" />
              <Skeleton className="h-2 w-full" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-10 w-full" />
            </div>
            <div className="border border-border rounded-xl p-6 bg-card space-y-4">
              <Skeleton className="h-6 w-44" />
              <Skeleton className="h-4 w-56" />
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, index) => (
                  <div key={index} className="flex items-start gap-3">
                    <Skeleton className="mt-1.5 h-2.5 w-2.5 rounded-full" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="w-4 h-4 mr-2" /> New Project</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Create New Project</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <Input placeholder="Project title" value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => e.key === "Enter" && void createProject()} />
              <Button onClick={() => void createProject()}>Create</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Project card or add project */}
        {firstProject ? (
          <div className="border border-border rounded-xl p-6 bg-card flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold">{firstProject.name}</h2>
              <FolderIcon />
            </div>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-muted-foreground">Progress</span>
                <span>{progress}%</span>
              </div>
              <div className="w-full h-2 bg-secondary rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-info rounded-full transition-all" style={{ width: `${progress}%` }} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Tasks: {completedTasks}/{totalTasks}</p>
            <div className="flex items-center justify-between border-t border-border pt-4 mt-auto">
              <span className="text-xs text-muted-foreground">Created: {new Date(firstProject.createdAt).toLocaleDateString()}</span>
              <button onClick={() => navigate(`/projects/${firstProject.id}`)} className="text-sm font-medium text-foreground hover:text-primary flex items-center gap-1">View →</button>
            </div>
            {latestBacklog && (
              <div className="border border-border rounded-lg p-4 bg-secondary/50 mt-2">
                <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1">≡ Latest Backlog Task</p>
                <p className="text-sm font-medium">{latestBacklog.title}</p>
              </div>
            )}
          </div>
        ) : (
          <button onClick={() => setOpen(true)} className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center gap-3 hover:border-primary/50 transition-colors">
            <Plus className="w-6 h-6 text-muted-foreground" />
            <span className="text-muted-foreground font-medium">Add Project</span>
          </button>
        )}

        {/* Recent Activity */}
        <div className="border border-dashed border-border rounded-xl p-6">
          <h2 className="text-xl font-bold mb-1">Recent Activity</h2>
          <p className="text-sm text-muted-foreground mb-4">Latest changes to your projects</p>
          {recentActivity.length === 0 ? (
            <p className="text-sm text-muted-foreground">No recent activity</p>
          ) : (
            <div className="flex flex-col gap-3">
              {recentActivity.map(event => (
                <div key={event.id} className="flex items-start gap-3">
                  <div className={`w-2.5 h-2.5 rounded-full mt-1.5 shrink-0 ${statusColor(event.type)}`} />
                  <div>
                    <p className="text-sm font-medium">{event.title}</p>
                    <p className="text-xs text-muted-foreground">{event.projectName && `${event.projectName} • `}{timeAgo(event.timestamp)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
          <button onClick={() => navigate("/timeline")} className="text-sm font-medium mt-4 block mx-auto hover:text-primary">View Timeline</button>
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function FolderIcon() {
  return <div className="w-8 h-8 rounded bg-primary/20 flex items-center justify-center"><span className="text-primary text-sm">📁</span></div>;
}

function timeAgo(ts: string) {
  const diff = Date.now() - new Date(ts).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(ts).toLocaleDateString();
}
