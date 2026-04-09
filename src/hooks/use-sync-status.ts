import { useEffect, useState } from "react";
import { store } from "@/lib/store";

export function useSyncStatus() {
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error">(() => store.getSyncStatus());

  useEffect(() => {
    const unsubscribe = store.onSyncStatusChange(setSyncStatus);
    return unsubscribe;
  }, []);

  return syncStatus;
}
