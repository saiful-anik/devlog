import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Github, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSession, logout, type AuthSession } from "@/lib/auth";
import { startStoreSync } from "@/lib/store";
import { useSyncStatus } from "@/hooks/use-sync-status";
import AppSidebar from "./AppSidebar";

export default function AppLayout() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const syncStatus = useSyncStatus();

  useEffect(() => {
    let isMounted = true;

    void getSession().then((authSession) => {
      if (!isMounted) return;
      setSession(authSession);
      if (authSession) {
        void startStoreSync(authSession.id);
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await logout();
      window.location.assign("/login");
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex min-h-screen md:h-screen md:overflow-hidden">
      <AppSidebar />
      <main className="flex min-w-0 flex-1 min-h-0 flex-col overflow-y-auto p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] sm:p-6 sm:pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-8">
        <div className="mb-6 flex justify-end">
          <div className="flex w-full max-w-2xl flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
            <Badge variant="outline" className="flex h-8 w-8 items-center justify-center border-border bg-transparent p-0 text-xs font-medium sm:h-auto sm:w-auto sm:gap-2 sm:px-3 sm:py-1">
              <span
                className={`h-2 w-2 rounded-full ${
                  syncStatus === "syncing"
                    ? "bg-yellow-500"
                    : syncStatus === "error"
                      ? "bg-red-500"
                  : "bg-emerald-500"
                }`}
              />
              <span className="sr-only sm:not-sr-only">{syncStatus === "syncing" ? "Syncing..." : syncStatus === "error" ? "Sync error" : "Cloud sync"}</span>
            </Badge>

            <Badge variant="secondary" className="flex items-center gap-2 px-3 py-1 text-xs font-medium">
              <Github className="h-3.5 w-3.5" />
              {session?.name ?? "GitHub user"}
            </Badge>

            <Button
              variant="outline"
              size="sm"
              className="h-8 w-8 p-0 sm:w-auto sm:gap-2 sm:px-3"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
              aria-label={isSigningOut ? "Signing out" : "Sign out"}
              title={isSigningOut ? "Signing out" : "Sign out"}
            >
              <LogOut className="h-4 w-4" />
              <span className="sr-only sm:not-sr-only">{isSigningOut ? "Signing out..." : "Sign out"}</span>
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
