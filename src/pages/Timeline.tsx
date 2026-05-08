import { useState, useEffect, useRef } from "react";
import { Plus, Calendar, ImagePlus, X, FolderKanban, ListTodo, BookOpen, Sparkles, Image } from "lucide-react";
import { store, TimelineEvent, getCachedTimeline, resolveImageSrc, getScreenshotSizeLimit, formatBytes, ProjectScreenshot } from "@/lib/store";
import type { Task } from "@/lib/store";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import { supabase } from "@/lib/supabase";

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>(getCachedTimeline());
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [isLoading, setIsLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
        const maxSize = await getScreenshotSizeLimit();
        if (blob.size > maxSize) {
          toast.error(`Clipboard image too large (${formatBytes(blob.size)}). Max ${formatBytes(maxSize)} allowed.`);
          setClipboardImage(null);
          setClipboardStatus("error");
          return;
        }
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

  useEffect(() => {
    let active = true;

    const load = async () => {
      try {
        const timeline = await store.getTimeline();
        if (!active) return;

        // Fetch project screenshots and add them as events
        let allEvents = [...timeline];
        if (supabase) {
          try {
            const { data: screenshots } = await supabase
              .from("project_screenshots")
              .select("*")
              .order("created_at", { ascending: false });

            if (screenshots) {
              // Get projects for screenshot names
              const projects = await store.getProjects();
              const projectMap = Object.fromEntries(projects.map(p => [p.id, p.name]));

              const screenshotEvents: TimelineEvent[] = screenshots.map((screenshot) => ({
                id: screenshot.id,
                type: "screenshot" as const,
                title: `${projectMap[screenshot.project_id] || "Project"} - ${screenshot.caption || "Screenshot"}`,
                description: screenshot.caption || "Project screenshot",
                image: screenshot.file_path,
                projectId: screenshot.project_id,
                projectName: projectMap[screenshot.project_id],
                timestamp: screenshot.created_at,
              }));

              allEvents = [...allEvents, ...screenshotEvents].sort(
                (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
              );
            }
          } catch (error) {
            console.error("Failed to fetch screenshots:", error);
          }
        }

        setEvents(allEvents);
      } finally {
        if (active) setIsLoading(false);
      }
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  useStoreSubscription(["timeline"], () => {
    setEvents(getCachedTimeline());
  });

  const resetForm = () => {
    setTitle("");
    setDesc("");
    setScreenshot(null);
    setScreenshotPreview(null);
    setClipboardImage(null);
    setClipboardStatus("idle");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDialogChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      void readClipboardImage();
      return;
    }
    resetForm();
  };

  const handleScreenshotChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) {
      setScreenshot(null);
      setScreenshotPreview(null);
      return;
    }

    const maxSize = await getScreenshotSizeLimit();
    if (file.size > maxSize) {
      toast.error(`File too large (${formatBytes(file.size)}). Max ${formatBytes(maxSize)} allowed.`);
      event.target.value = "";
      return;
    }

    const dataUrl = await readFileAsDataUrl(file);
    setScreenshot(file.name);
    setScreenshotPreview(dataUrl);
  };

  const addCustom = async () => {
    if (!title.trim()) return;
    await store.addTimelineEvent({
      type: "custom",
      title: title.trim(),
      description: desc.trim(),
      image: screenshotPreview ?? clipboardImage ?? undefined,
    });
    resetForm();
    setOpen(false);
  };

  const grouped = events.reduce<Record<string, TimelineEvent[]>>((acc, e) => {
    const day = new Date(e.timestamp).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    (acc[day] ??= []).push(e);
    return acc;
  }, {});

  const typeLabel = (t: string) => {
    if (t === "project") return "Project";
    if (t === "task") return "Task";
    if (t === "log") return "Log";
    if (t === "screenshot") return "Screenshot";
    return "Custom";
  };

  const movedToStatus = (event: TimelineEvent): Task["status"] | null => {
    if (event.type !== "task") return null;
    const match = event.description.match(/\bto\s+(backlog|in progress|completed)\b/i);
    if (!match?.[1]) return null;
    const normalized = match[1].toLowerCase().replace(" ", "-");
    if (normalized === "backlog" || normalized === "in-progress" || normalized === "completed") {
      return normalized;
    }
    return null;
  };

  const eventStyle = (event: TimelineEvent) => {
    const { type } = event;
    if (type === "project") {
      return {
        icon: FolderKanban,
        dot: "bg-emerald-500",
        badge: "bg-emerald-500/20 text-white dark:text-emerald-100 border-emerald-500/40",
      };
    }

    if (type === "screenshot") {
      return {
        icon: Image,
        dot: "bg-rose-500",
        badge: "bg-rose-500/20 text-white dark:text-rose-100 border-rose-500/40",
      };
    }

    if (type === "task") {
      const toStatus = movedToStatus(event);
      if (toStatus === "completed") {
        return {
          icon: ListTodo,
          dot: "bg-success",
          badge: "bg-success/20 text-white dark:text-emerald-100 border-success/40",
        };
      }

      if (toStatus === "in-progress") {
        return {
          icon: ListTodo,
          dot: "bg-warning",
          badge: "bg-warning/20 text-white dark:text-amber-100 border-warning/40",
        };
      }

      if (toStatus === "backlog") {
        return {
          icon: ListTodo,
          dot: "bg-primary",
          badge: "bg-primary/20 text-white dark:text-blue-100 border-primary/40",
        };
      }

      return {
        icon: ListTodo,
        dot: "bg-sky-500",
        badge: "bg-sky-500/20 text-white dark:text-sky-100 border-sky-500/40",
      };
    }

    if (type === "log") {
      return {
        icon: BookOpen,
        dot: "bg-amber-500",
        badge: "bg-amber-500/20 text-white dark:text-amber-100 border-amber-500/40",
      };
    }

    return {
      icon: Sparkles,
      dot: "bg-violet-500",
      badge: "bg-violet-500/20 text-white dark:text-violet-100 border-violet-500/40",
    };
  };

  return (
    <div>
      {isLoading ? (
        <div className="space-y-8">
          <Skeleton className="h-9 w-72" />
          <div className="space-y-10">
            {Array.from({ length: 3 }).map((_, dayIndex) => (
              <div key={dayIndex} className="space-y-4">
                <Skeleton className="h-5 w-40" />
                <div className="flex flex-col gap-3 ml-3 border-l-2 border-border pl-6">
                  {Array.from({ length: 2 }).map((__, eventIndex) => (
                    <div key={eventIndex} className="bg-card border border-border rounded-xl p-5 space-y-3">
                      <Skeleton className="h-3 w-24" />
                      <Skeleton className="h-4 w-2/3" />
                      <Skeleton className="h-4 w-1/2" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Development Timeline</h1>
        <Dialog open={open} onOpenChange={handleDialogChange}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> Add Custom Event</Button></DialogTrigger>
          <DialogContent className="max-h-[85vh] w-[min(92vw,48rem)] overflow-y-auto">
            <DialogHeader><DialogTitle>Add Custom Event</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-4 mt-2 pb-2">
              <Input placeholder="Event title" value={title} onChange={e => setTitle(e.target.value)} />
              <Textarea placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(e) => void handleScreenshotChange(e)} />
              <div className="rounded-lg border border-border bg-secondary/30 p-3">
                <p className="mb-2 text-sm font-medium">Clipboard</p>
                {clipboardStatus === "loading" && <p className="text-sm text-muted-foreground">Checking clipboard...</p>}
                {clipboardStatus === "empty" && <p className="text-sm text-muted-foreground">No image in clipboard.</p>}
                {clipboardStatus === "error" && <p className="text-sm text-muted-foreground">Clipboard access is unavailable. Use file upload instead.</p>}
                {clipboardStatus === "ready" && clipboardImage && (
                  <div className="relative inline-flex w-fit">
                    <img
                      src={resolveImageSrc(clipboardImage)}
                      alt="Clipboard preview"
                      className="max-h-56 w-full rounded-md border border-border object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setClipboardImage(null);
                        setClipboardStatus("empty");
                      }}
                      className="absolute right-2 top-2 rounded-full bg-background/90 p-1 text-muted-foreground shadow hover:text-foreground"
                      aria-label="Remove clipboard image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-dashed border-border p-3">
                <p className="mb-2 text-sm font-medium">File explorer</p>
                <Button type="button" variant="outline" className="w-full" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus className="mr-2 h-4 w-4" /> Choose image from computer
                </Button>
                {screenshotPreview && (
                  <div className="relative mt-3 inline-flex w-fit">
                    <img
                      src={screenshotPreview}
                      alt="Selected file preview"
                      className="max-h-56 w-full rounded-md border border-border object-contain"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        setScreenshot(null);
                        setScreenshotPreview(null);
                        if (fileInputRef.current) fileInputRef.current.value = "";
                      }}
                      className="absolute right-2 top-2 rounded-full bg-background/90 p-1 text-muted-foreground shadow hover:text-foreground"
                      aria-label="Remove selected image"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}
                {screenshot && <p className="mt-2 text-xs text-muted-foreground">Selected: {screenshot}</p>}
              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" onClick={() => handleDialogChange(false)}>
                  Cancel
                </Button>
                <Button type="button" onClick={() => void addCustom()}>
                  Add Event
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {Object.keys(grouped).length === 0 && <p className="text-muted-foreground">No events yet. Create a project or add a custom event.</p>}

      {Object.entries(grouped).map(([day, dayEvents]) => (
        <div key={day} className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-primary" />
            <span className="font-semibold">{day}</span>
          </div>
          <div className="flex flex-col gap-3 ml-3 border-l-2 border-border pl-6">
            {dayEvents.map(event => (
              <div key={event.id} className="bg-card border border-border rounded-xl p-5">
                <div className="mb-2 flex items-center gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-medium ${eventStyle(event).badge}`}>
                    {(() => {
                      const Icon = eventStyle(event).icon;
                      return <Icon className="h-3.5 w-3.5" />;
                    })()}
                    {typeLabel(event.type)}
                  </span>
                  <span className={`h-2 w-2 rounded-full ${eventStyle(event).dot}`} />
                  <span className="text-xs text-muted-foreground">
                    {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
                <p className="text-sm">{event.title}</p>
                {event.description && <p className="text-sm text-muted-foreground mt-1">{event.description}</p>}
                {event.image && <img src={resolveImageSrc(event.image)} alt="" className="mt-3 rounded-lg max-w-xs" />}
              </div>
            ))}
          </div>
        </div>
      ))}
        </>
      )}
    </div>
  );
}
