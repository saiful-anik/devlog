import { useEffect, useRef, useState } from "react";
import { Calendar, ImagePlus, Plus, X } from "lucide-react";
import { formatBytes, getScreenshotSizeLimit, resolveImageSrc, store, type TimelineEvent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState("");
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "loading" | "empty" | "error">("idle");
  const imageInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { void store.getTimeline().then(setEvents); }, []);

  const addEvent = async () => {
    if (!title.trim()) return;
    const event = await store.addTimelineEvent({ type: "custom", title: title.trim(), description: description.trim(), image: image || undefined });
    setEvents((current) => [event, ...current]);
    setTitle("");
    setDescription("");
    setImage("");
    setClipboardStatus("idle");
  };

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

  return <div className="mx-auto max-w-3xl">
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
      {events.map((event) => <article key={event.id} className="rounded-xl border bg-card p-5">
        <div className="mb-1 flex items-center gap-2 font-semibold"><Calendar className="h-4 w-4" />{event.title}</div>
        {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
        {event.image && <img src={resolveImageSrc(event.image)} alt={`Attachment for ${event.title}`} className="mt-3 max-h-80 rounded-lg border" />}
        <time className="mt-3 block text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</time>
      </article>)}
      {!events.length && <p className="text-sm text-muted-foreground">No events yet.</p>}
    </div>
  </div>;
}
