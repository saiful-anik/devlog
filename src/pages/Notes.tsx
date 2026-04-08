import { useState, useEffect } from "react";
import { Plus, Trash2 } from "lucide-react";
import { store, Note, getCachedNotes } from "@/lib/store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useStoreSubscription } from "@/hooks/useStoreSubscription";

export default function Notes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      const n = await store.getNotes();
      if (!active) return;
      setNotes(n);
      if (n.length > 0) setSelected(n[0]);
    };

    void load();

    return () => {
      active = false;
    };
  }, []);

  useStoreSubscription(["notes"], () => {
    const cached = getCachedNotes();
    setNotes(cached);
    setSelected((current) => cached.find((note) => note.id === current?.id) ?? cached[0] ?? null);
  });

  const saveAll = (updated: Note[]) => {
    setNotes([...updated]);
    void store.saveNotes(updated);
  };

  const createNote = () => {
    const now = new Date().toISOString();
    const note: Note = { id: store.uid(), title: "Untitled Note", content: "", createdAt: now, updatedAt: now };
    const updated = [note, ...notes];
    saveAll(updated);
    setSelected(note);
  };

  const updateNote = (field: "title" | "content", value: string) => {
    if (!selected) return;
    selected[field] = value;
    selected.updatedAt = new Date().toISOString();
    const updated = notes.map(n => n.id === selected.id ? { ...selected } : n);
    saveAll(updated);
    setSelected({ ...selected });
  };

  const deleteNote = (id: string) => {
    const updated = notes.filter(n => n.id !== id);
    saveAll(updated);
    setSelected(updated[0] ?? null);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">Notes</h1>
        <Button onClick={createNote}><Plus className="w-4 h-4 mr-2" /> New Note</Button>
      </div>
      <div className="flex gap-6 min-h-[60vh]">
        <div className="w-64 shrink-0 flex flex-col gap-1 border-r border-border pr-4">
          {notes.map(n => (
            <button key={n.id} onClick={() => setSelected(n)} className={`text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${selected?.id === n.id ? "bg-primary text-primary-foreground" : "hover:bg-secondary"}`}>
              {n.title || "Untitled"}
            </button>
          ))}
          {notes.length === 0 && <p className="text-xs text-muted-foreground px-3">No notes yet</p>}
        </div>
        <div className="flex-1">
          {selected ? (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-2">
                <Input value={selected.title} onChange={e => updateNote("title", e.target.value)} className="text-lg font-semibold bg-transparent border-none px-0 focus-visible:ring-0" />
                <Button variant="ghost" size="icon" onClick={() => deleteNote(selected.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
              </div>
              <p className="text-xs text-muted-foreground">Last updated {new Date(selected.updatedAt).toLocaleString()}</p>
              <Textarea value={selected.content} onChange={e => updateNote("content", e.target.value)} placeholder="Start writing..." className="min-h-[400px] bg-card border-border resize-none" />
            </div>
          ) : (
            <p className="text-muted-foreground">Select or create a note</p>
          )}
        </div>
      </div>
    </div>
  );
}
