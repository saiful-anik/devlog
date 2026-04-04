import { useState, useEffect } from "react";
import { Plus, Calendar } from "lucide-react";
import { store, TimelineEvent } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export default function Timeline() {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");

  useEffect(() => { setEvents(store.getTimeline()); }, []);

  const addCustom = () => {
    if (!title.trim()) return;
    store.addTimelineEvent({ type: "custom", title: title.trim(), description: desc.trim() });
    setEvents(store.getTimeline());
    setTitle("");
    setDesc("");
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
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Development Timeline</h1>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button><Plus className="w-4 h-4 mr-2" /> Add Custom Event</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Add Custom Event</DialogTitle></DialogHeader>
            <div className="flex flex-col gap-4 mt-2">
              <Input placeholder="Event title" value={title} onChange={e => setTitle(e.target.value)} />
              <Textarea placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} />
              <Button onClick={addCustom}>Add Event</Button>
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
                {event.image && <img src={event.image} alt="" className="mt-3 rounded-lg max-w-xs" />}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
