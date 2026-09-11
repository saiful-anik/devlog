import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isAuthenticated } from "@/lib/auth";
import AppLayout from "./components/AppLayout";
import Dashboard from "./pages/Dashboard";
import Projects from "./pages/Projects";
import ProjectDetail from "./pages/ProjectDetail";
import Notes from "./pages/Notes";
import Timeline from "./pages/Timeline";
import Login from "./pages/Login";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function RequireAuth({ children }: { children: JSX.Element }) {
  const location = useLocation();
  const [state, setState] = useState<"checking" | "authed" | "unauth">("checking");

  useEffect(() => {
    let active = true;

    void isAuthenticated().then((authed) => {
      if (!active) return;
      setState(authed ? "authed" : "unauth");
    });

    return () => {
      active = false;
    };
  }, []);

  if (state === "checking") {
    return <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">Checking GitHub session...</div>;
  }

  if (state === "unauth") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return children;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter future={{ v7_relativeSplatPath: true, v7_startTransition: true }}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
            <Route path="/" element={<Dashboard />} />
            <Route path="/projects" element={<Projects />} />
            <Route path="/projects/:id" element={<ProjectDetail />} />
            <Route path="/notes" element={<Notes />} />
            <Route path="/timeline" element={<Timeline />} />
          </Route>
          <Route path="*" element={<RequireAuth><NotFound /></RequireAuth>} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
