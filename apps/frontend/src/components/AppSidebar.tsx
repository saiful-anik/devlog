import { NavLink, useLocation } from "react-router-dom";
import { Calendar, FileText, FolderKanban, Home } from "lucide-react";

const links = [
  { to: "/", label: "Dashboard", icon: Home },
  { to: "/projects", label: "Projects", icon: FolderKanban },
  { to: "/notes", label: "Notes", icon: FileText },
  { to: "/timeline", label: "Timeline", icon: Calendar },
];

export default function AppSidebar() {
  const location = useLocation();

  return (
    <aside className="sticky top-0 flex h-screen w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex items-center gap-2 px-6 py-5">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center">
          <FolderKanban className="w-4 h-4 text-primary-foreground" />
        </div>
        <span className="text-xl font-bold text-primary font-[Space_Grotesk]">DevLog</span>
      </div>
      <nav className="flex flex-col gap-1 px-3 mt-2">
        {links.map(({ to, label, icon: Icon }) => {
          const isActive = to === "/" ? location.pathname === "/" : location.pathname.startsWith(to);
          return (
            <NavLink
              key={to}
              to={to}
              className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-sidebar-foreground hover:bg-secondary"
              }`}
            >
              <Icon className="w-5 h-5" />
              {label}
            </NavLink>
          );
        })}
      </nav>
    </aside>
  );
}
