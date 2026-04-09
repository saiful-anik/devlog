import { useState, useEffect, useRef } from "react";
import { Plus, Calendar, ImagePlus, X } from "lucide-react";
import { store, TimelineEvent, getCachedTimeline, resolveImageSrc } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>(getCachedTimeline());
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [clipboardImage, setClipboardImage] = useState<string | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [isLoading, setIsLoading] = useState(true);
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
      const timeline = await store.getTimeline();
      if (!active) return;
      setEvents(timeline);
      setIsLoading(false);
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
    return "Custom";
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
                <p className="text-xs text-muted-foreground mb-1">
                  {typeLabel(event.type)} • {new Date(event.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </p>
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
