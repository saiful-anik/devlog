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
  const [projectsLoadFailed, setProjectsLoadFailed] = useState(false);
  const [timelineLoadFailed, setTimelineLoadFailed] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const [projectsResult, timelineResult] = await Promise.allSettled([
          store.getProjects(),
          store.getTimeline(),
        ]);

        if (!active) return;

        setProjects(projectsResult.status === "fulfilled" ? projectsResult.value : getCachedProjects());
        setTimeline(timelineResult.status === "fulfilled" ? timelineResult.value : getCachedTimeline());
        setProjectsLoadFailed(projectsResult.status === "rejected");
        setTimelineLoadFailed(timelineResult.status === "rejected");
      } finally {
        if (active) setIsLoading(false);
      }
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

  const inProgressProjects = projects
    .map((project) => ({
      project,
      inProgressTasks: project.tasks.filter((task) => task.status === "in-progress"),
      completedTasks: project.tasks.filter((task) => task.status === "completed").length,
    }))
    .filter(({ inProgressTasks }) => inProgressTasks.length > 0);

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
        {/* In-progress projects */}
        {projectsLoadFailed ? (
          <section className="border-2 border-dashed border-destructive/40 rounded-xl p-12 flex flex-col items-center justify-center gap-3">
            <h2 className="font-semibold">Couldn’t load projects</h2>
            <p className="text-center text-sm text-muted-foreground">Refresh the page to try again.</p>
          </section>
        ) : inProgressProjects.length ? (
          <section className="border border-border rounded-xl p-6 bg-card">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold">In Progress</h2>
                <p className="text-sm text-muted-foreground">Projects with active work</p>
              </div>
              <FolderIcon />
            </div>
            <div className="space-y-3">
              {inProgressProjects.map(({ project, inProgressTasks, completedTasks }) => {
                const progress = project.tasks.length ? Math.round((completedTasks / project.tasks.length) * 100) : 0;
                return (
                  <button key={project.id} onClick={() => navigate(`/projects/${project.id}`)} className="w-full rounded-lg border border-border bg-secondary/50 p-4 text-left transition-colors hover:border-primary/50 hover:bg-secondary">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold">{project.name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{progress}%</span>
                    </div>
                    <div className="mb-3 h-1.5 w-full overflow-hidden rounded-full bg-background">
                      <div className="h-full rounded-full bg-gradient-to-r from-primary to-info" style={{ width: `${progress}%` }} />
                    </div>
                    <p className="truncate text-xs text-muted-foreground">In progress: <span className="text-foreground">{inProgressTasks.map((task) => task.title).join(", ")}</span></p>
                  </button>
                );
              })}
            </div>
          </section>
        ) : (
          <section className="border-2 border-dashed border-border rounded-xl p-12 flex flex-col items-center justify-center gap-3">
            <FolderIcon />
            <h2 className="font-semibold">No projects in progress</h2>
            <p className="text-center text-sm text-muted-foreground">Move a task to In Progress to see its project here.</p>
            {!projects.length && <Button variant="outline" onClick={() => setOpen(true)}><Plus className="mr-2 h-4 w-4" />Add Project</Button>}
          </section>
        )}

        {/* Recent Activity */}
        <div className="border border-dashed border-border rounded-xl p-6">
          <h2 className="text-xl font-bold mb-1">Recent Activity</h2>
          <p className="text-sm text-muted-foreground mb-4">Latest changes to your projects</p>
          {timelineLoadFailed ? (
            <p className="text-sm text-muted-foreground">Couldn’t load recent activity. Refresh the page to try again.</p>
          ) : recentActivity.length === 0 ? (
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
