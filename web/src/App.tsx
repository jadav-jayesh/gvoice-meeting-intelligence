import { useEffect, useState } from "react";
import { Outlet, useNavigate } from "react-router-dom";
import { Sidebar } from "./components/shell/Sidebar";
import { MobileNav } from "./components/shell/MobileNav";
import { CommandPalette } from "./components/shell/CommandPalette";

export function App() {
  return <Shell />;
}

function Shell() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    let pendingPrefix: string | null = null;
    let pendingTimer: ReturnType<typeof setTimeout> | null = null;
    const clearPending = () => {
      pendingPrefix = null;
      if (pendingTimer) {
        clearTimeout(pendingTimer);
        pendingTimer = null;
      }
    };

    function handler(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (isTyping) return;
      if (pendingPrefix === "g") {
        const k = event.key.toLowerCase();
        if (k === "d") navigate("/dashboard");
        else if (k === "m") navigate("/meetings");
        else if (k === "i") navigate("/insights");
        clearPending();
        return;
      }
      if (event.key.toLowerCase() === "g") {
        pendingPrefix = "g";
        pendingTimer = setTimeout(clearPending, 700);
      }
    }
    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      clearPending();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-bg">
      <Sidebar onOpenPalette={() => setPaletteOpen(true)} />
      <MobileNav onOpenPalette={() => setPaletteOpen(true)} />
      <main className="lg:pl-[var(--sidebar-w)] pb-20 lg:pb-0 min-h-screen">
        <Outlet />
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
