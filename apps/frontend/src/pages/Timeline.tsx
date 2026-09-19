import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle2, ClipboardList, FolderPlus, Image, ImagePlus, LoaderCircle, Plus, Sparkles, X, type LucideIcon } from "lucide-react";
import { formatBytes, getCachedTimeline, getScreenshotSizeLimit, resolveImageSrc, store, type TimelineEvent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";
import { apiFetch } from "@/lib/api";

type EventVisual = { label: string; Icon: LucideIcon; accent: string; badge: string; marker: string };

const eventVisuals: Record<TimelineEvent["type"], EventVisual> = {
  project: { label: "Project", Icon: FolderPlus, accent: "border-l-emerald-500", badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300", marker: "bg-emerald-500" },
  task: { label: "Task", Icon: CheckCircle2, accent: "border-l-sky-500", badge: "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300", marker: "bg-sky-500" },
  log: { label: "Log", Icon: ClipboardList, accent: "border-l-violet-500", badge: "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300", marker: "bg-violet-500" },
  screenshot: { label: "Screenshot", Icon: Image, accent: "border-l-amber-500", badge: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300", marker: "bg-amber-500" },
  custom: { label: "Update", Icon: Sparkles, accent: "border-l-primary", badge: "border-primary/30 bg-primary/10 text-primary", marker: "bg-primary" },
};

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [initialLoadFailed, setInitialLoadFailed] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const imageInputRef = useRef<HTMLInputElement>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      const adoption = await apiFetch("/api/internal/adopt-local-data", { method: "POST" });
      if (!adoption.ok) throw new Error("Unable to adopt migrated data");
      return store.getTimelinePage();
    })().then((page) => {
      if (!active) return;
      setEvents(page.events);
      setNextCursor(page.nextCursor);
    }).catch(() => {
      if (active) setInitialLoadFailed(true);
    }).finally(() => {
      if (active) setIsInitialLoading(false);
    });
    return () => { active = false; };
  }, []);
  useStoreSubscription(["timeline"], () => setEvents((current) => mergeTimelineEvents(current, getCachedTimeline())));

  const addEvent = async () => {
    if (!title.trim()) return;
    const event = await store.addTimelineEvent({ type: "custom", title: title.trim(), description: description.trim(), image: image || undefined });
    setEvents((current) => [event, ...current]);
    setTitle("");
    setDescription("");
    setImage("");
    setClipboardStatus("idle");
  };

  const loadMore = useCallback(async () => {
    if (!nextCursor || isLoadingMore) return;
    setIsLoadingMore(true);
    try {
      const page = await store.getTimelinePage(nextCursor);
      setEvents((current) => mergeTimelineEvents(current, page.events));
      setNextCursor(page.nextCursor);
    } finally {
      setIsLoadingMore(false);
    }
  }, [isLoadingMore, nextCursor]);

  useEffect(() => {
    const target = loadMoreRef.current;
    if (!target || !nextCursor) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) void loadMore();
    }, { rootMargin: "80px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore, nextCursor]);

  const readFileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to read image"));
    reader.readAsDataURL(file);
  });

  const setImageFromFile = async (file: File) => {
    const maxSize = await getScreenshotSizeLimit();
    if (file.size > maxSize) {
      toast.error(`Image too large (${formatBytes(file.size)}). Max ${formatBytes(maxSize)} allowed.`);
      return;
    }
    try {
      setImage(await readFileAsDataUrl(file));
      setClipboardStatus("idle");
    } catch {
      toast.error("Failed to read image");
    }
  };

  const readClipboardImage = async () => {
    if (!navigator.clipboard?.read) {
      setClipboardStatus("empty");
      return;
    }
    try {
      setClipboardStatus("loading");
      for (const item of await navigator.clipboard.read()) {
        const imageType = item.types.find((type) => type.startsWith("image/"));
        if (!imageType) continue;
        await setImageFromFile(new File([await item.getType(imageType)], "clipboard-image", { type: imageType }));
        return;
      }
      setClipboardStatus("empty");
    } catch {
      setClipboardStatus("error");
    }
  };

  return <div className="mx-auto max-w-3xl pb-20">
    <h1 className="mb-8 text-3xl font-bold">Timeline</h1>
    <section className="mb-8 rounded-xl border bg-card p-5">
      <Input className="mb-3" placeholder="What happened?" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Textarea className="mb-3" placeholder="Optional details" value={description} onChange={(event) => setDescription(event.target.value)} />
      <div className="mb-3">
        {image ? (
          <div className="relative w-fit">
            <img src={resolveImageSrc(image)} alt="Event attachment preview" className="max-h-48 rounded-lg border" />
            <button onClick={() => setImage("")} aria-label="Remove image" className="absolute right-2 top-2 rounded-full bg-black/50 p-1 text-white hover:bg-black/70">
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={() => void readClipboardImage()} disabled={clipboardStatus === "loading"}>
              <ImagePlus className="mr-2 h-4 w-4" />{clipboardStatus === "loading" ? "Reading clipboard..." : "Paste image"}
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={() => imageInputRef.current?.click()}>Choose image</Button>
            <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void setImageFromFile(file);
              event.target.value = "";
            }} />
            {clipboardStatus === "empty" && <span className="text-xs text-muted-foreground">No image in clipboard.</span>}
            {clipboardStatus === "error" && <span className="text-xs text-muted-foreground">Clipboard access unavailable. Choose an image instead.</span>}
          </div>
        )}
      </div>
      <Button onClick={() => void addEvent()}><Plus className="mr-2 h-4 w-4" />Add event</Button>
    </section>
    <div className="space-y-3">
      {isInitialLoading && <TimelineLoadingSkeleton />}
      {!isInitialLoading && events.map((event) => {
        const visual = eventVisuals[event.type];
        const EventIcon = visual.Icon;

        return <article key={event.id} className={`relative overflow-hidden rounded-xl border border-l-4 bg-card p-5 shadow-sm transition-shadow hover:shadow-md ${visual.accent}`}>
          <div className="flex gap-4">
            <div className={`mt-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm ${visual.marker}`}>
              <EventIcon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline" className={`gap-1.5 px-2 py-0.5 text-[11px] font-semibold ${visual.badge}`}>
                  <EventIcon className="h-3 w-3" aria-hidden="true" />
                  {visual.label}
                </Badge>
                {event.projectName && <Badge variant="secondary" className="max-w-full truncate px-2 py-0.5 text-[11px] font-medium">{event.projectName}</Badge>}
                <time dateTime={event.timestamp} title={new Date(event.timestamp).toLocaleString()} className="ml-auto whitespace-nowrap text-xs text-muted-foreground">
                  {timeAgo(event.timestamp)}
                </time>
              </div>
              <h2 className="text-base font-semibold leading-snug text-foreground">{event.title}</h2>
              {event.description && <p className="mt-1.5 text-sm leading-6 text-muted-foreground">{event.description}</p>}
              {event.image && <div className="mt-4 overflow-hidden rounded-lg border bg-muted/30">
                <img src={resolveImageSrc(event.image)} alt={`Attachment for ${event.title}`} className="max-h-80 w-full object-contain" />
              </div>}
            </div>
          </div>
        </article>;
      })}
      {!isInitialLoading && initialLoadFailed && <p className="text-sm text-muted-foreground">Couldn’t load timeline events. Refresh the page to try again.</p>}
      {!isInitialLoading && !initialLoadFailed && !events.length && <p className="text-sm text-muted-foreground">No events yet.</p>}
      {!isInitialLoading && nextCursor && <div ref={loadMoreRef} className="flex h-14 items-center justify-center" aria-live="polite">
        {isLoadingMore && <span className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />Loading more events…</span>}
      </div>}
    </div>
  </div>;
}

function TimelineLoadingSkeleton() {
  return <div className="space-y-3" aria-label="Loading timeline events">
    {Array.from({ length: 3 }).map((_, index) => <div key={index} className="rounded-xl border border-l-4 border-l-muted bg-card p-5">
      <div className="flex gap-4">
        <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
        <div className="flex-1 space-y-3"><Skeleton className="h-4 w-28" /><Skeleton className="h-5 w-3/4" /><Skeleton className="h-4 w-1/2" /></div>
      </div>
    </div>)}
  </div>;
}

function mergeTimelineEvents(current: TimelineEvent[], incoming: TimelineEvent[]) {
  const unique = new Map(current.map((event) => [event.id, event]));
  for (const event of incoming) unique.set(event.id, event);
  return [...unique.values()].sort((first, second) => new Date(second.timestamp).getTime() - new Date(first.timestamp).getTime());
}

function timeAgo(timestamp: string) {
  const elapsed = Date.now() - new Date(timestamp).getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(timestamp).toLocaleDateString();
}
