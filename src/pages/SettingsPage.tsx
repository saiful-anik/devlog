import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { getSession, logout } from "@/lib/auth";
import { store } from "@/lib/store";
import { supabase } from "@/lib/supabase";

type BackupImageRef = {
  source: string;
  fileName: string;
};

type StorageUsage = {
  bucketSize: number;
  fileCount: number;
  error?: string;
};

function formatBytes(bytes: number) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

function isDataUrl(value: string) {
  return value.startsWith("data:");
}

function parseStoredImageRef(value: string) {
  if (!value || isDataUrl(value) || value.startsWith("http")) return null;
  const slashIndex = value.indexOf("/");
  if (slashIndex <= 0) return null;
  return {
    bucket: value.slice(0, slashIndex),
    objectPath: value.slice(slashIndex + 1),
  };
}

function dataUrlToFileParts(dataUrl: string) {
  const [meta, base64] = dataUrl.split(",");
  if (!meta || !base64) throw new Error("Invalid image data URL.");

  const mimeMatch = /data:([^;]+);base64/.exec(meta);
  const mimeType = mimeMatch?.[1] ?? "application/octet-stream";
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  const extension = mimeType.split("/")[1] || "bin";
  return {
    blob: new Blob([bytes], { type: mimeType }),
    extension,
  };
}

function fileNameFromRef(source: string, fallbackIndex: number) {
  if (isDataUrl(source)) {
    return `inline-${fallbackIndex}.png`;
  }

  const ref = parseStoredImageRef(source);
  if (!ref) return `image-${fallbackIndex}.png`;

  const parts = ref.objectPath.split("/");
  return parts[parts.length - 1] || `image-${fallbackIndex}.png`;
}

async function imageSourceToBackupFile(source: string, fallbackIndex: number) {
  if (isDataUrl(source)) {
    const { blob, extension } = dataUrlToFileParts(source);
    return {
      name: `images/inline-${fallbackIndex}.${extension}`,
      blob,
    };
  }

  const ref = parseStoredImageRef(source);
  if (!ref) {
    const response = await fetch(source);
    const blob = await response.blob();
    const extension = blob.type.split("/")[1] || "bin";
    return {
      name: `images/external-${fallbackIndex}.${extension}`,
      blob,
    };
  }

  if (!supabase) {
    throw new Error("Supabase storage unavailable.");
  }

  const { data, error } = await supabase.storage.from(ref.bucket).download(ref.objectPath);
  if (error) throw error;

  return {
    name: `images/${ref.bucket}/${fileNameFromRef(source, fallbackIndex)}`,
    blob: data,
  };
}

async function calculateStorageUsage(): Promise<StorageUsage> {
  if (!supabase) {
    return { bucketSize: 0, fileCount: 0, error: "Supabase not configured" };
  }

  try {
    const buckets = ["devlog-images"];
    let totalSize = 0;
    let totalFiles = 0;

    for (const bucket of buckets) {
      try {
        const { data: files, error } = await supabase.storage.from(bucket).list("", {
          limit: 10000,
        });

        if (error) throw error;

        if (files) {
          files.forEach((file) => {
            if (file.metadata?.size) {
              totalSize += file.metadata.size;
            }
            totalFiles += 1;
          });
        }
      } catch (err) {
        console.warn(`Could not list bucket ${bucket}:`, err);
      }
    }

    return { bucketSize: totalSize, fileCount: totalFiles };
  } catch (error) {
    console.error("Error calculating storage:", error);
    return {
      bucketSize: 0,
      fileCount: 0,
      error: "Could not fetch storage info",
    };
  }
}

export default function SettingsPage() {
  const navigate = useNavigate();
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null);
  const [isLoadingStorage, setIsLoadingStorage] = useState(true);

  useEffect(() => {
    const fetchStorageUsage = async () => {
      setIsLoadingStorage(true);
      const usage = await calculateStorageUsage();
      setStorageUsage(usage);
      setIsLoadingStorage(false);
    };

    void fetchStorageUsage();
  }, []);

  const downloadBackup = async () => {
    setIsBackingUp(true);
    try {
      const [projects, notes, timeline, session] = await Promise.all([
        store.getProjects(),
        store.getNotes(),
        store.getTimeline(),
        getSession(),
      ]);

      const imageSources = new Map<string, BackupImageRef>();

      const addSource = (source?: string) => {
        if (!source) return;
        if (imageSources.has(source)) return;
        imageSources.set(source, {
          source,
          fileName: fileNameFromRef(source, imageSources.size + 1),
        });
      };

      timeline.forEach((event) => addSource(event.image));

      const payload = {
        exportedAt: new Date().toISOString(),
        userId: session?.id ?? null,
        projects,
        notes,
        timeline,
        images: Array.from(imageSources.values()).map(({ source, fileName }) => ({
          source,
          fileName,
        })),
      };

      const zip = new JSZip();
      zip.file("backup.json", JSON.stringify(payload, null, 2));

      const imageEntries = Array.from(imageSources.values());
      await Promise.all(
        imageEntries.map(async ({ source }, index) => {
          const { name, blob } = await imageSourceToBackupFile(source, index + 1);
          zip.file(name, blob);
        }),
      );

      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `devlog-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.zip`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);
      URL.revokeObjectURL(url);
    } finally {
      setIsBackingUp(false);
    }
  };

  const deleteAccountData = async () => {
    if (!supabase) {
      throw new Error("Supabase configuration is missing.");
    }

    const session = await getSession();
    if (!session) {
      throw new Error("No active session found.");
    }

    setIsDeleting(true);
    try {
      const tablesInDeleteOrder = [
        "timeline_events",
        "notes",
        "tasks",
        "projects",
      ] as const;

      for (const table of tablesInDeleteOrder) {
        const { error } = await supabase.from(table).delete().eq("user_id", session.id);
        if (error) throw error;
      }

      await logout();
      navigate("/login", { replace: true });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div>
      <h1 className="mb-8 text-3xl font-bold">Settings</h1>

      <div className="grid max-w-3xl gap-4">
        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">Cloud Sync</h2>
          <p className="text-sm text-muted-foreground">
            Your projects, tasks, notes, and timeline are stored in Supabase and stay synced across devices.
          </p>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">Storage Usage</h2>
          {isLoadingStorage ? (
            <p className="text-sm text-muted-foreground">Loading storage info...</p>
          ) : storageUsage?.error ? (
            <p className="text-sm text-destructive">{storageUsage.error}</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Images in cloud buckets</p>
                <div className="text-right">
                  <p className="font-semibold">{formatBytes(storageUsage?.bucketSize ?? 0)}</p>
                  <p className="text-xs text-muted-foreground">{storageUsage?.fileCount ?? 0} files</p>
                </div>
              </div>
              <div className="rounded-lg bg-muted p-2">
                <div className="w-full bg-muted-foreground/20 rounded h-2">
                  <div
                    className="bg-blue-500 h-2 rounded"
                    style={{
                      width: Math.min(((storageUsage?.bucketSize ?? 0) / (100 * 1024 * 1024)) * 100, 100) + "%",
                    }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatBytes(storageUsage?.bucketSize ?? 0)} of 100 MB (typical limit)
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-2 font-semibold">Backup</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            Download all your data as a ZIP backup with JSON plus bundled images.
          </p>
          <Button type="button" variant="outline" onClick={() => void downloadBackup()} disabled={isBackingUp}>
            {isBackingUp ? "Preparing backup..." : "Download Backup"}
          </Button>
        </div>

        <div className="rounded-xl border border-destructive/40 bg-card p-6">
          <h2 className="mb-2 font-semibold text-destructive">Delete Account</h2>
          <p className="mb-4 text-sm text-muted-foreground">
            This deletes your cloud data (projects, tasks, notes, timeline) and signs you out.
          </p>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="destructive" disabled={isDeleting}>
                {isDeleting ? "Deleting..." : "Delete Account"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete your account data?</AlertDialogTitle>
                <AlertDialogDescription>
                  This action is irreversible. All your synced data will be removed.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void deleteAccountData()}>
                  Delete Permanently
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    </div>
  );
}
