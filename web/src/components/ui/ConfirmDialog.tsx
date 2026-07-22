import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./Button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
  icon?: ReactNode;
  onConfirm: () => void;
  onClose: () => void;
}

// Small, reusable confirmation modal — portalled to <body>, dims the page with
// a scrim, traps Escape, locks body scroll and auto-focuses the confirm button.
// Used for destructive / irreversible actions (log out, delete, …).
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "danger",
  loading = false,
  icon,
  onConfirm,
  onClose
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !loading) onClose();
    }
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, loading, onClose]);

  if (!open || typeof document === "undefined") return null;

  const accent = tone === "danger" ? "text-negative bg-negative/10" : "text-brand-500 bg-brand-500/10";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <button
        type="button"
        aria-label="Cancel"
        onClick={() => !loading && onClose()}
        className="absolute inset-0 bg-scrim animate-fade-in"
      />
      <div className="relative w-full max-w-[400px] glass-card rounded-2xl p-6 animate-fade-scale">
        <div className="flex flex-col items-center text-center">
          {icon && <div className={`grid place-items-center w-12 h-12 rounded-2xl ${accent}`}>{icon}</div>}
          <h2 id="confirm-title" className="mt-4 text-[17px] font-semibold tracking-tight text-ink">
            {title}
          </h2>
          {description && <p className="mt-1.5 text-[13px] text-inkMute leading-relaxed">{description}</p>}
        </div>
        <div className="mt-6 flex gap-2.5">
          <Button variant="secondary" size="md" className="flex-1" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button autoFocus variant={tone} size="md" className="flex-1" loading={loading} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}
