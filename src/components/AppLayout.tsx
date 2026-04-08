import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import { Github, LogOut } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getSession, logout, type AuthSession } from "@/lib/auth";
import AppSidebar from "./AppSidebar";

export default function AppLayout() {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  useEffect(() => {
    let isMounted = true;

    void getSession().then((authSession) => {
      if (!isMounted) return;
      setSession(authSession);
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
    <div className="flex h-screen overflow-hidden">
      <AppSidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex justify-end">
          <div className="flex w-full max-w-2xl flex-wrap items-center justify-end gap-2 rounded-2xl border border-border bg-background/90 px-3 py-2 shadow-sm backdrop-blur">
            <Badge variant="outline" className="flex items-center gap-2 border-border bg-transparent px-3 py-1 text-xs font-medium">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Cloud sync
            </Badge>

            <Badge variant="secondary" className="flex items-center gap-2 px-3 py-1 text-xs font-medium">
              <Github className="h-3.5 w-3.5" />
              {session?.name ?? "GitHub user"}
            </Badge>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-2"
              onClick={() => void handleSignOut()}
              disabled={isSigningOut}
            >
              <LogOut className="h-4 w-4" />
              {isSigningOut ? "Signing out..." : "Sign out"}
            </Button>
          </div>
        </div>
        <Outlet />
      </main>
    </div>
  );
}
