import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getSession, type AuthSession } from "@/lib/auth";
import { hasSupabaseConfig, supabase } from "@/lib/supabase";

type CheckState = "pending" | "pass" | "fail";

type CheckResult = {
  label: string;
  state: CheckState;
  detail: string;
};

const storageBuckets = ["project-screenshot", "task-screenshot"] as const;

const checks = [
  { key: "projects", label: "projects", columns: "id, title, description, created_at, updated_at" },
  { key: "tasks", label: "tasks", columns: "id, title, details, status, due_date, created_at, updated_at" },
  { key: "notes", label: "notes", columns: "id, content, created_at, updated_at" },
  { key: "timeline_events", label: "timeline_events", columns: "id, event_type, payload, occurred_at, created_at, updated_at" },
  { key: "project_screenshots", label: "project_screenshots", columns: "id, file_path, caption, created_at, updated_at" },
  { key: "task_screenshots", label: "task_screenshots", columns: "id, file_path, caption, created_at, updated_at" },
] as const;

export default function Health() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [results, setResults] = useState<CheckResult[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    const run = async () => {
      setLoading(true);

      const authSession = await getSession();
      if (!active) return;
      setSession(authSession);

      if (!supabase) {
        setResults([
          { label: "Supabase config", state: "fail", detail: "Missing VITE_SUPABASE_URL or publishable key." },
        ]);
        setLoading(false);
        return;
      }

      const tableChecks = await Promise.all(
        checks.map(async ({ key, label, columns }) => {
          try {
            const { error, data } = await supabase.from(key).select(columns).limit(1);
            if (error) {
              return { label, state: "fail" as const, detail: error.message };
            }

            return {
              label,
              state: "pass" as const,
              detail: `${data?.length ?? 0} row(s) loaded with expected columns.`,
            };
          } catch (error) {
            return {
              label,
              state: "fail" as const,
              detail: error instanceof Error ? error.message : "Unknown error",
            };
          }
        }),
      );

      const storageChecks = await Promise.all(
        storageBuckets.map(async (bucket) => {
          if (!authSession) {
            return {
              label: `storage:${bucket}`,
              state: "fail" as const,
              detail: "Sign in required to validate bucket read/write.",
            };
          }

          const probePath = `health-check/${authSession.id}/${crypto.randomUUID()}.txt`;

          try {
            const { error: readError } = await supabase.storage
              .from(bucket)
              .list("", { limit: 1 });

            if (readError) {
              return {
                label: `storage:${bucket}`,
                state: "fail" as const,
                detail: `Read failed: ${readError.message}`,
              };
            }

            const probeFile = new Blob(["health-check"], { type: "text/plain" });
            const { error: uploadError } = await supabase.storage
              .from(bucket)
              .upload(probePath, probeFile, {
                upsert: false,
                contentType: "text/plain",
              });

            if (uploadError) {
              return {
                label: `storage:${bucket}`,
                state: "fail" as const,
                detail: `Upload failed: ${uploadError.message}`,
              };
            }

            const { error: deleteError } = await supabase.storage
              .from(bucket)
              .remove([probePath]);

            if (deleteError) {
              return {
                label: `storage:${bucket}`,
                state: "fail" as const,
                detail: `Upload succeeded, cleanup failed: ${deleteError.message}`,
              };
            }

            return {
              label: `storage:${bucket}`,
              state: "pass" as const,
              detail: "Read, upload, and cleanup succeeded.",
            };
          } catch (error) {
            return {
              label: `storage:${bucket}`,
              state: "fail" as const,
              detail: error instanceof Error ? error.message : "Unknown storage error",
            };
          }
        }),
      );

      if (!active) return;
      setResults([
        { label: "Supabase config", state: hasSupabaseConfig ? "pass" : "fail", detail: hasSupabaseConfig ? "Environment variables are present." : "Missing Supabase URL or publishable key." },
        { label: "GitHub session", state: authSession ? "pass" : "fail", detail: authSession ? `Signed in as ${authSession.name}.` : "No active GitHub session found." },
        ...tableChecks,
        ...storageChecks,
      ]);
      setLoading(false);
    };

    void run();

    return () => {
      active = false;
    };
  }, []);

  const overallPass = results.length > 0 && results.every((result) => result.state === "pass");

  return (
    <div className="mx-auto flex min-h-screen max-w-4xl items-center px-4 py-10">
      <Card className="w-full">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-3xl">Health Check</CardTitle>
              <CardDescription>Verifies Supabase auth and database access.</CardDescription>
            </div>
            <Badge variant={overallPass ? "default" : "destructive"} className="px-3 py-1 text-xs uppercase tracking-wide">
              {loading ? "Checking" : overallPass ? "Healthy" : "Needs attention"}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg border border-border bg-secondary/20 p-4 text-sm text-muted-foreground">
            This page checks the live Supabase connection using the real table schema.
          </div>

          <div className="grid gap-3">
            {results.map((result) => (
              <div key={result.label} className="rounded-lg border border-border p-4">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium">{result.label}</p>
                  <Badge variant={result.state === "pass" ? "default" : "destructive"} className="px-2 py-0 text-[11px] uppercase tracking-wide">
                    {result.state}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{result.detail}</p>
              </div>
            ))}
          </div>

          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={() => window.location.reload()}>
              Recheck
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}