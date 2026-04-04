import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function SettingsPage() {
  const [cleared, setCleared] = useState(false);

  const clearAll = () => {
    localStorage.clear();
    setCleared(true);
  };

  return (
    <div>
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      <div className="border border-border rounded-xl p-6 bg-card max-w-lg">
        <h2 className="font-semibold mb-2">Data Management</h2>
        <p className="text-sm text-muted-foreground mb-4">All data is stored locally in your browser. Clearing data is irreversible.</p>
        <Button variant="destructive" onClick={clearAll} disabled={cleared}>
          {cleared ? "Data Cleared ✓" : "Clear All Data"}
        </Button>
      </div>
    </div>
  );
}
