import { useEffect, useState } from "react";
import { Calendar, Plus } from "lucide-react";
import { store, type TimelineEvent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => { void store.getTimeline().then(setEvents); }, []);

  const addEvent = async () => {
    if (!title.trim()) return;
    const event = await store.addTimelineEvent({ type: "custom", title: title.trim(), description: description.trim() });
    setEvents((current) => [event, ...current]);
    setTitle("");
    setDescription("");
  };

  return <div className="mx-auto max-w-3xl">
    <h1 className="mb-8 text-3xl font-bold">Timeline</h1>
    <section className="mb-8 rounded-xl border bg-card p-5">
      <Input className="mb-3" placeholder="What happened?" value={title} onChange={(event) => setTitle(event.target.value)} />
      <Textarea className="mb-3" placeholder="Optional details" value={description} onChange={(event) => setDescription(event.target.value)} />
      <Button onClick={() => void addEvent()}><Plus className="mr-2 h-4 w-4" />Add event</Button>
    </section>
    <div className="space-y-3">
      {events.map((event) => <article key={event.id} className="rounded-xl border bg-card p-5">
        <div className="mb-1 flex items-center gap-2 font-semibold"><Calendar className="h-4 w-4" />{event.title}</div>
        {event.description && <p className="text-sm text-muted-foreground">{event.description}</p>}
        <time className="mt-3 block text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleString()}</time>
      </article>)}
      {!events.length && <p className="text-sm text-muted-foreground">No events yet.</p>}
    </div>
  </div>;
}
