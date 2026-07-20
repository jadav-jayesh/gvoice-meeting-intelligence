import { useEffect, useRef, useState } from "react";
import { Icon } from "../Icon";
import { createShareLink, revokeShareLink } from "../../lib/api";

interface Props {
  sessionId: string;
  initialEnabled?: boolean;
  initialToken?: string;
}

function urlFromToken(token: string): string {
  return `${window.location.origin}/share/${token}`;
}

// Header control to create / copy / revoke a meeting's public share link.
// Self-contained: manages its own popover + link state so it can be dropped into
// the detail page header without touching the page's polling/render logic.
export function ShareControl({ sessionId, initialEnabled, initialToken }: Props) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(Boolean(initialEnabled && initialToken));
  const [url, setUrl] = useState<string | null>(initialEnabled && initialToken ? urlFromToken(initialToken) : null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close the popover on an outside click / Escape.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const res = await createShareLink(sessionId);
      setEnabled(res.enabled);
      setUrl(res.url ?? (res.token ? urlFromToken(res.token) : null));
    } catch {
      setError("Couldn’t create the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleRevoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeShareLink(sessionId);
      setEnabled(false);
      setUrl(null);
    } catch {
      setError("Couldn’t revoke the link. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Share meeting"
        className={`inline-flex items-center gap-1.5 h-9 px-3.5 rounded-lg border text-[12.5px] font-medium transition-colors focus-ring shrink-0 ${
          enabled
            ? "border-brand-500/40 bg-brand-500/5 text-brand-600"
            : "border-line bg-surface text-inkMute hover:text-ink"
        }`}
      >
        <Icon.Link size={13} />
        {enabled ? "Shared" : "Share"}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 z-50 rounded-xl border border-line bg-surface shadow-lg p-4">
          <div className="flex items-start gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-500/10 text-brand-600">
              <Icon.Link size={15} />
            </span>
            <div className="min-w-0">
              <h3 className="text-[14px] font-semibold text-ink">Public link</h3>
              <p className="text-[12px] text-inkMute mt-0.5 leading-snug">
                Anyone with the link can view this meeting — recording, summary and transcript — without signing in.
              </p>
            </div>
          </div>

          {error && (
            <div role="alert" className="mt-3 rounded-lg border border-negative/30 bg-negative/5 px-2.5 py-2 text-[12px] text-negative">
              {error}
            </div>
          )}

          {enabled && url ? (
            <>
              <div className="mt-3 flex items-center gap-1.5 rounded-lg border border-line bg-canvas px-2.5 py-2">
                <input
                  readOnly
                  value={url}
                  onFocus={(e) => e.currentTarget.select()}
                  className="min-w-0 flex-1 bg-transparent text-[12px] text-ink outline-none"
                />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md bg-brand-500 text-white text-[12px] font-medium hover:bg-brand-600 focus-ring shrink-0"
                >
                  {copied ? <Icon.CheckCircle size={13} /> : <Icon.Copy size={13} />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="inline-flex items-center gap-1.5 text-[11.5px] text-positive">
                  <span className="h-1.5 w-1.5 rounded-full bg-positive" />
                  Public link is live
                </span>
                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={busy}
                  className="text-[12px] font-medium text-negative hover:text-negativeHi focus-ring rounded disabled:opacity-60"
                >
                  {busy ? "Revoking…" : "Stop sharing"}
                </button>
              </div>
            </>
          ) : (
            <button
              type="button"
              onClick={handleCreate}
              disabled={busy}
              className="mt-3 inline-flex w-full items-center justify-center gap-2 h-9 rounded-lg bg-brand-500 text-white text-[13px] font-medium hover:bg-brand-600 focus-ring disabled:opacity-60"
            >
              {busy && <span className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin" />}
              Create public link
            </button>
          )}
        </div>
      )}
    </div>
  );
}
