/**
 * Resolve the human-readable meeting name from the available sources, in
 * priority order:
 *   1. providerSubject — the real subject from the meeting provider (Teams
 *      Graph subject / Zoom topic). Most authoritative when present.
 *   2. scheduledTitle  — the title of the calendar event that scheduled the
 *      auto-join. The user typed this, so it beats anything generated.
 *   3. aiShortTitle    — an AI-generated short title. Only a fallback for
 *      manually-joined meetings that never had a real title.
 *
 * Returns undefined when no source has a usable value, so callers can leave the
 * existing meetingName untouched rather than blanking it.
 */
export function resolveMeetingName(sources: {
  providerSubject?: string;
  scheduledTitle?: string;
  aiShortTitle?: string;
}): string | undefined {
  return (
    sources.providerSubject?.trim() ||
    sources.scheduledTitle?.trim() ||
    sources.aiShortTitle?.trim() ||
    undefined
  );
}
