import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { Button } from "../ui/Button";
import { Icon } from "../Icon";
import { FormField } from "../../auth/FormField";
import { createBotSession } from "../../lib/api";
import type { BotPlatform } from "../../lib/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onCreated: (sessionId: string) => void;
}

const platformOptions: Array<{ value: BotPlatform; label: string; sample: string }> = [
  {
    value: "google_meet",
    label: "Google Meet",
    sample: "https://meet.google.com/abc-defg-hij"
  },
  {
    value: "microsoft_teams",
    label: "Microsoft Teams",
    sample: "https://teams.microsoft.com/l/meetup-join/..."
  },
  {
    value: "zoom",
    label: "Zoom",
    sample: "https://us05web.zoom.us/j/12345678901?pwd=..."
  }
];

const urlPattern = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

export function JoinMeetingModal({ open, onClose, onCreated }: Props) {
  const [platform, setPlatform] = useState<BotPlatform>("google_meet");
  const [meetingUrl, setMeetingUrl] = useState("");
  const [passcode, setPasscode] = useState("");
  const [urlTouched, setUrlTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const urlRef = useRef<HTMLInputElement>(null);
  const firstFocusRef = useRef<HTMLSelectElement>(null);

  // Reset on close so the next open is clean.
  useEffect(() => {
    if (!open) {
      setMeetingUrl("");
      setPasscode("");
      setUrlTouched(false);
      setSubmitting(false);
      setServerError(null);
      setInfo(null);
    }
  }, [open]);

  // Drop any passcode the user typed before switching away from Zoom — only
  // Zoom uses it, and we don't want a hidden value sneaking into the request.
  useEffect(() => {
    if (platform !== "zoom") setPasscode("");
  }, [platform]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);

    // Lock background scroll while the modal is open. Compensate for the
    // scrollbar disappearing so the page underneath doesn't shift sideways.
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;

    // Focus the first interactive element WITHOUT scrolling the background —
    // default focus() will scroll the page to bring the target into view,
    // even when the target is in a fixed-position modal.
    const id = window.setTimeout(
      () => firstFocusRef.current?.focus({ preventScroll: true }),
      50
    );

    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(id);
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  const currentPlatform = platformOptions.find((o) => o.value === platform)!;
  const urlError = urlTouched
    ? !meetingUrl.trim()
      ? "Meeting URL is required"
      : !urlPattern.test(meetingUrl.trim())
        ? "Enter a valid http(s) URL"
        : null
    : null;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setServerError(null);
    setUrlTouched(true);
    if (!meetingUrl.trim() || !urlPattern.test(meetingUrl.trim())) {
      urlRef.current?.focus();
      return;
    }

    setSubmitting(true);
    setInfo(null);
    try {
      const { sessionId, attached } = await createBotSession({
        platform,
        meetingUrl: meetingUrl.trim(),
        meetingPasscode: passcode.trim() || undefined
      });
      if (attached) {
        // A bot is already live in this meeting — the server attached to it
        // instead of launching a duplicate. That session isn't ours to open,
        // so show a note rather than navigating to a page we can't view.
        setSubmitting(false);
        setInfo("A gVoice bot is already recording this meeting. No second bot was added.");
        return;
      }
      onCreated(sessionId);
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Couldn't start the bot. Try again.");
      setSubmitting(false);
    }
  }

  // Portal to <body> so the modal escapes any ancestor with `transform`,
  // `filter`, `perspective` or `contain` set — any of those break
  // `position: fixed` (it becomes relative to that ancestor instead of the
  // viewport). The meetings page wrapper uses page-enter which leaves a
  // transform on the element, which is exactly that trap.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="join-meeting-title"
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-scrim animate-fade-in"
      />

      <div className="relative w-full max-w-md glass-card rounded-2xl p-6 sm:p-7 animate-fade-scale">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-inkFaint">New session</p>
            <h2
              id="join-meeting-title"
              className="text-[20px] font-semibold tracking-tighter2 text-ink mt-1"
            >
              Join a meeting
            </h2>
            <p className="text-[13px] text-inkSoft mt-1">
              Paste a meeting link — we'll spin up a bot and capture the transcript.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 inline-flex items-center justify-center rounded-md text-inkMute hover:text-ink hover-soft focus-ring shrink-0"
          >
            <Icon.Close size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
          {serverError && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-negative/30 bg-negative/5 px-3 py-2.5 text-[12.5px] text-negative"
            >
              <Icon.AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>{serverError}</span>
            </div>
          )}

          {info && (
            <div
              role="status"
              className="flex items-start gap-2 rounded-lg border border-positive/30 bg-positive/5 px-3 py-2.5 text-[12.5px] text-positive"
            >
              <Icon.CheckCircle size={14} className="mt-0.5 shrink-0" />
              <span>{info}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="join-platform"
              className="block text-[12.5px] font-medium text-inkSoft"
            >
              Platform
            </label>
            <div className="relative">
              <select
                ref={firstFocusRef}
                id="join-platform"
                value={platform}
                onChange={(e) => setPlatform(e.target.value as BotPlatform)}
                className="block w-full h-11 appearance-none rounded-lg bg-surfaceHi text-ink border border-line px-3.5 pr-9 text-[13.5px] focus:border-brand-500 focus:bg-surface focus:shadow-[0_0_0_4px_rgb(34_197_94/0.15)] outline-none transition-[border-color,box-shadow,background-color] duration-150"
              >
                {platformOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <Icon.ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-inkMute"
              />
            </div>
          </div>

          <FormField
            ref={urlRef}
            label="Meeting URL"
            type="url"
            name="meetingUrl"
            placeholder={currentPlatform.sample}
            value={meetingUrl}
            onChange={(e) => setMeetingUrl(e.target.value)}
            error={urlError}
            required
          />

          {platform === "zoom" && (
            <FormField
              label={
                <>
                  Passcode{" "}
                  <span className="text-inkFaint font-normal">(optional)</span>
                </>
              }
              name="meetingPasscode"
              placeholder="Zoom passcode if the link needs one"
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              hint="Required when the join URL doesn't include pwd=."
            />
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="md" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" size="md" loading={submitting} icon={!submitting ? <Icon.Bolt size={13} /> : undefined}>
              {submitting ? "Starting bot…" : "Join meeting"}
            </Button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
