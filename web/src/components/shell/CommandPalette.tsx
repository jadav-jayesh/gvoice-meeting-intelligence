import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Icon } from "../Icon";
import { listMeetings } from "../../lib/api";
import type { MeetingListItem } from "../../lib/types";
import { platformLabel } from "../../lib/format";

interface Props {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  hint?: string;
  group: string;
  icon: React.ReactNode;
  onSelect: () => void;
}

export function CommandPalette({ open, onClose }: Props) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [meetings, setMeetings] = useState<MeetingListItem[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => {
      listMeetings({ page: 1, pageSize: 8, search: query || undefined })
        .then((response) => setMeetings(response.items))
        .catch(() => setMeetings([]));
    }, 140);
    return () => clearTimeout(id);
  }, [open, query]);

  const navCommands: CommandItem[] = useMemo(
    () => [
      {
        id: "nav:dashboard",
        label: "Go to Dashboard",
        group: "Navigate",
        icon: <Icon.Dashboard size={13} />,
        onSelect: () => navigate("/dashboard")
      },
      {
        id: "nav:meetings",
        label: "Go to Meetings",
        group: "Navigate",
        icon: <Icon.Meetings size={13} />,
        onSelect: () => navigate("/meetings")
      },
      {
        id: "nav:insights",
        label: "Go to Insights",
        group: "Navigate",
        icon: <Icon.Insights size={13} />,
        onSelect: () => navigate("/insights")
      }
    ],
    [navigate]
  );

  const meetingCommands: CommandItem[] = meetings.map((meeting) => ({
    id: `meeting:${meeting.sessionId}`,
    label: meeting.summary?.slice(0, 80).trim() || meeting.sessionId,
    hint: platformLabel(meeting.platform),
    group: "Meetings",
    icon: <Icon.Play size={12} />,
    onSelect: () => navigate(`/meetings/${encodeURIComponent(meeting.sessionId)}`)
  }));

  const all: CommandItem[] = useMemo(() => {
    if (query.trim().length === 0) return [...navCommands, ...meetingCommands];
    const q = query.toLowerCase();
    return [...navCommands, ...meetingCommands].filter(
      (item) => item.label.toLowerCase().includes(q) || (item.hint ?? "").toLowerCase().includes(q)
    );
  }, [navCommands, meetingCommands, query]);

  useEffect(() => setActive(0), [query]);

  useEffect(() => {
    if (!open) return;
    function handler(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      } else if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((current) => Math.min(all.length - 1, current + 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((current) => Math.max(0, current - 1));
      } else if (event.key === "Enter") {
        event.preventDefault();
        const item = all[active];
        if (item) {
          item.onSelect();
          onClose();
        }
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, all, active, onClose]);

  useEffect(() => {
    if (!listRef.current) return;
    const node = listRef.current.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (node) node.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const groups: Record<string, CommandItem[]> = {};
  all.forEach((item) => {
    if (!groups[item.group]) groups[item.group] = [];
    groups[item.group].push(item);
  });
  let cursor = 0;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] px-4 animate-fade-in">
      <button
        type="button"
        aria-label="Close palette"
        onClick={onClose}
        className="absolute inset-0 bg-scrim"
      />
      <div className="relative w-full max-w-xl bg-surface border border-line rounded-xl shadow-pop overflow-hidden animate-fade-scale">
        <div className="flex items-center gap-3 px-4 h-12 border-b border-line">
          <Icon.Search size={15} className="text-inkMute" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search meetings or jump to a page…"
            className="flex-1 bg-transparent outline-none text-[14px] text-ink placeholder:text-inkFaint"
          />
          <kbd className="px-1.5 py-0.5 text-[10px] font-mono text-inkFaint rounded border border-line bg-bg">
            esc
          </kbd>
        </div>
        <div ref={listRef} className="max-h-[55vh] overflow-y-auto py-2">
          {Object.entries(groups).map(([groupName, items]) => (
            <div key={groupName} className="px-2 mb-1.5 last:mb-0">
              <p className="px-2 py-1 text-[10px] uppercase tracking-widest text-inkFaint">
                {groupName}
              </p>
              {items.map((item) => {
                const idx = cursor;
                cursor += 1;
                const isActive = active === idx;
                return (
                  <button
                    key={item.id}
                    data-index={idx}
                    type="button"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => {
                      item.onSelect();
                      onClose();
                    }}
                    className={`w-full flex items-center gap-3 px-2 h-9 rounded-md text-[13px] text-left transition-colors ${
                      isActive ? "bg-surfaceHi text-ink" : "text-inkSoft"
                    }`}
                  >
                    <span
                      className={`w-6 h-6 rounded-md flex items-center justify-center transition-colors ${
                        isActive
                          ? "bg-brand-500 text-white"
                          : "bg-surfaceHi text-inkMute"
                      }`}
                    >
                      {item.icon}
                    </span>
                    <span className="flex-1 truncate">{item.label}</span>
                    {item.hint && (
                      <span className="text-[11px] text-inkMute">{item.hint}</span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
          {all.length === 0 && (
            <p className="px-4 py-8 text-center text-sm text-inkMute">No results.</p>
          )}
        </div>
        <div className="flex items-center justify-between px-4 h-9 border-t border-line text-[11px] text-inkFaint">
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded border border-line bg-bg">↑</kbd>
            <kbd className="px-1 py-0.5 rounded border border-line bg-bg">↓</kbd>
            navigate
          </span>
          <span className="flex items-center gap-1.5">
            <kbd className="px-1 py-0.5 rounded border border-line bg-bg">↵</kbd>
            open
          </span>
        </div>
      </div>
    </div>
  );
}
