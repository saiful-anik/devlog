/**
 * Screenshot Upload Dialog Component
 * Reusable component for uploading project screenshots with clipboard and file selection
 */

import { useState, useRef } from "react";
import { ImagePlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { formatBytes, getScreenshotSizeLimit } from "@/lib/store";

interface ScreenshotUploadDialogProps {
  projectId: string;
  projectName: string;
  onUploadSuccess?: (screenshot: { id: string; file_path: string; caption?: string; created_at: string }) => void;
  trigger?: React.ReactNode;
}

export function ScreenshotUploadDialog({
  projectId,
  projectName,
  onUploadSuccess,
  trigger,
}: ScreenshotUploadDialogProps) {
  const [open, setOpen] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [clipboardStatus, setClipboardStatus] = useState<"idle" | "loading" | "ready" | "empty" | "error">("idle");
  const [caption, setCaption] = useState("");
  const [isUploading, setIsUploading] = useState(false);
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
          setClipboardStatus("error");
          return;
        }

        const dataUrl = await readFileAsDataUrl(new File([blob], "clipboard-image", { type: blob.type }));
        setScreenshot(dataUrl);
        setScreenshotPreview(dataUrl);
        setClipboardStatus("ready");
        return;
      }

      setClipboardStatus("empty");
    } catch {
      setClipboardStatus("error");
    }
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      // Auto-read clipboard when dialog opens
      void readClipboardImage();
    }
  };

  const handleFileSelect = async (files: FileList | null) => {
    if (!files?.length) return;

    const file = files[0];
    const maxSize = await getScreenshotSizeLimit();
    if (file.size > maxSize) {
      toast.error(`File too large (${formatBytes(file.size)}). Max ${formatBytes(maxSize)} allowed.`);
      return;
    }

    try {
      const dataUrl = await readFileAsDataUrl(file);
      setScreenshot(dataUrl);
      setScreenshotPreview(dataUrl);
    } catch (error) {
      toast.error("Failed to read screenshot");
    }
  };

  const handleUpload = async () => {
    if (!screenshot) {
      toast.error("Please select a screenshot");
      return;
    }

    if (!supabase) {
      toast.error("Supabase not configured");
      return;
    }

    try {
      setIsUploading(true);

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Not authenticated");
        return;
      }

      // Convert data URL to blob
      const response = await fetch(screenshot);
      const blob = await response.blob();
      const timestamp = Date.now();
      const filename = `${user.id}/${projectId}/screenshot-${timestamp}.jpg`;

      // Upload to storage
      const { error: uploadError } = await supabase.storage
        .from("devlog-images")
        .upload(filename, blob, { upsert: false });

      if (uploadError) {
        toast.error(`Upload failed: ${uploadError.message}`);
        return;
      }

      // Insert screenshot record into database with bucket/path format for resolveImageSrc
      const { data, error: dbError } = await supabase.from("project_screenshots").insert({
        user_id: user.id,
        project_id: projectId,
        file_path: `devlog-images/${filename}`,
        caption: caption || null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).select();

      if (dbError) {
        toast.error(`Failed to save screenshot: ${dbError.message}`);
        return;
      }

      if (data && data[0]) {
        toast.success("Screenshot uploaded successfully");
        onUploadSuccess?.(data[0]);
        setScreenshot(null);
        setScreenshotPreview(null);
        setCaption("");
        setOpen(false);
      }
    } catch (error) {
      toast.error(`Upload failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => {
    setScreenshot(null);
    setScreenshotPreview(null);
    setCaption("");
    setClipboardStatus("idle");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <Button size="sm" variant="outline" className="gap-2">
            <ImagePlus className="w-4 h-4" />
            Upload Screenshot
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Upload Screenshot</DialogTitle>
          <DialogDescription>Add a screenshot for {projectName}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {screenshotPreview ? (
            <div className="relative">
              <img src={screenshotPreview} alt="Preview" className="w-full rounded-lg border" />
              <button
                onClick={() => {
                  setScreenshot(null);
                  setScreenshotPreview(null);
                }}
                className="absolute top-2 right-2 bg-black/50 hover:bg-black/70 text-white rounded-full p-1 transition"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <Button
                onClick={readClipboardImage}
                disabled={clipboardStatus === "loading"}
                variant="outline"
                className="w-full"
              >
                {clipboardStatus === "loading" ? "Reading clipboard..." : "📋 Paste from Clipboard"}
              </Button>

              <Button onClick={() => fileInputRef.current?.click()} variant="outline" className="w-full">
                📁 Choose File
              </Button>

              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleFileSelect(e.target.files)}
              />

              {clipboardStatus === "empty" && (
                <p className="text-xs text-muted-foreground text-center">No image in clipboard</p>
              )}
              {clipboardStatus === "error" && (
                <p className="text-xs text-red-500 text-center">Failed to read clipboard</p>
              )}
            </div>
          )}

          <div>
            <label className="text-sm font-medium">Caption (optional)</label>
            <Textarea
              placeholder="Add a description or caption for this screenshot"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="mt-1 min-h-[80px]"
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={handleCancel} disabled={isUploading}>
              Cancel
            </Button>
            <Button onClick={handleUpload} disabled={!screenshot || isUploading}>
              {isUploading ? "Uploading..." : "Upload"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
