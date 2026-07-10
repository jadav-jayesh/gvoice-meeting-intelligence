import { z } from "zod";
import type { Logger } from "pino";
import { AzureOpenAIClient } from "./azureOpenAI";
import { env } from "../config/env";
import { dedupeParticipants } from "../processing/participants";
import type {
  ActionItem,
  DiarizedTranscriptSegment,
  MomReport,
  Participant,
  SentimentSummary
} from "../types/meeting";

// Validation for the AI response. Anything missing falls back to defaults so
// the renderer can keep rendering even if the model omits a section.
const priorityEnum = z.enum(["high", "medium", "low"]);
const statusEnum = z.enum(["open", "in_progress", "planned", "done"]);
const severityEnum = z.enum(["amber", "red"]);
const todoPriorityEnum = z.enum(["critical", "high", "medium", "low"]);

const responseSchema = z.object({
  executiveSummary: z.string().default(""),
  meetingPurpose: z.string().nullish().transform((v) => v ?? undefined),
  keyTakeaways: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string().nullish().transform((v) => v ?? "").default("")
      })
    )
    .default([]),
  toneBreakdown: z
    .object({
      positive: z.number().min(0).max(100),
      neutral: z.number().min(0).max(100),
      concerns: z.number().min(0).max(100)
    })
    .optional(),
  notableQuotes: z
    .array(
      z.object({
        text: z.string(),
        speaker: z.string().nullish().transform((v) => v ?? "").default(""),
        company: z.string().nullish().transform((v) => v ?? undefined)
      })
    )
    .default([]),
  positives: z
    .array(z.object({ title: z.string(), detail: z.string().nullish().transform((v) => v ?? "").default("") }))
    .default([]),
  concerns: z
    .array(z.object({ title: z.string(), detail: z.string().nullish().transform((v) => v ?? "").default("") }))
    .default([]),
  momSections: z
    .array(
      z.object({
        index: z.number().int().nonnegative(),
        tag: z.string().nullish().transform((v) => v ?? "").default(""),
        topic: z.string(),
        body: z.string().nullish().transform((v) => v ?? "").default("")
      })
    )
    .default([]),
  actionItems: z
    .array(
      z.object({
        task: z.string(),
        detail: z.string().nullish().transform((v) => v ?? undefined),
        owners: z.array(z.string()).nullish().transform((v) => v ?? undefined),
        owner: z.string().nullish().transform((v) => v ?? undefined),
        due: z.string().nullish().transform((v) => v ?? undefined),
        priority: priorityEnum.nullish().transform((v) => v ?? undefined),
        status: statusEnum.nullish().transform((v) => v ?? undefined)
      })
    )
    .default([]),
  topTodos: z
    .array(
      z.object({
        title: z.string(),
        detail: z.string().nullish().transform((v) => v ?? "").default(""),
        owner: z.string().nullish().transform((v) => v ?? undefined),
        priority: todoPriorityEnum.nullish().transform((v) => v ?? undefined),
        due: z.string().nullish().transform((v) => v ?? undefined)
      })
    )
    .default([]),
  risks: z
    .array(
      z.object({
        severity: severityEnum,
        title: z.string(),
        detail: z.string().nullish().transform((v) => v ?? "").default(""),
        owner: z.string().nullish().transform((v) => v ?? undefined)
      })
    )
    .default([]),
  nextSteps: z
    .array(
      z.object({
        period: z.string().nullish().transform((v) => v ?? "").default(""),
        title: z.string(),
        detail: z.string().nullish().transform((v) => v ?? "").default("")
      })
    )
    .default([]),
  attendees: z
    .array(
      z.object({
        name: z.string(),
        role: z.string().nullish().transform((v) => v ?? undefined)
      })
    )
    .default([])
});

export interface MomReportInput {
  meetingTitle: string;
  summary: string;
  participants: Participant[];
  transcript: DiarizedTranscriptSegment[];
  transcriptText: string;
  actionItems: ActionItem[];
  sentimentSummary?: SentimentSummary;
  durationSeconds: number;
  // When the meeting took place. Used to resolve relative day references
  // ("Friday", "next Monday") in nextSteps into concrete calendar dates.
  meetingDate?: Date;
}

export class MomReportService {
  constructor(
    private readonly logger?: Logger,
    private readonly client = new AzureOpenAIClient()
  ) {}

  async generate(input: MomReportInput): Promise<MomReport> {
    // Skip the AI entirely when we cannot produce anything meaningful — the
    // fallback renderer still gives a usable MOM from the raw summary.
    if (!input.transcriptText.trim() || env.ALLOW_MOCK_AI) {
      return buildFallbackReport(input, "fallback");
    }

    // The Teams/Meet caption pipeline often re-emits the same utterance from
    // the same speaker many times within minutes (the snapshot loop captures
    // the caption strip on every tick). Without dedup the indexed transcript
    // can be 2-3× longer than the meeting actually was, so a long session
    // hits the slice cap halfway through and the AI never sees the closing.
    // We collapse exact (speaker + normalized text) repeats within a 3-min
    // window, preserve each segment's ORIGINAL index so momSections.index
    // still maps back to diarizedTranscript, and raise the slice ceiling so a
    // genuine multi-hour meeting still fits.
    const dedupedForPrompt = dedupeTranscriptForPrompt(input.transcript);
    const indexedTranscript = dedupedForPrompt
      .map(
        ({ segment, originalIndex }) =>
          `[${originalIndex}] ${segment.speaker} (${segment.startTime.toFixed(2)}–${segment.endTime.toFixed(2)}s): ${segment.text}`
      )
      .join("\n")
      .slice(0, 400000);
    // Re-clean the participant roster here so legacy sessions whose stored
    // participants predate the capture-time filter (and still contain UI-label
    // junk like "Reframe"/"Gemini" or possessives like "Chetan's") don't leak
    // those into the attendee list when the report is (re)generated.
    const cleanParticipants = dedupeParticipants(input.participants);
    const participantList =
      cleanParticipants.map((p) => p.name).filter(Boolean).join(", ") || "Unknown";
    const existingActions = input.actionItems
      .map((item) => `- ${item.task}${item.assignee ? ` (owner: ${item.assignee})` : ""}`)
      .join("\n");

    try {
      const raw = await this.client.chatJson<unknown>(
        [
          {
            role: "system",
            content: [
              "You are a meeting analyst that produces a rich, executive-grade Minutes-of-Meeting (MOM) report.",
              "Return STRICT JSON ONLY with these keys: executiveSummary, meetingPurpose, keyTakeaways, toneBreakdown, notableQuotes, positives, concerns, momSections, actionItems, topTodos, risks, nextSteps, attendees.",
              "Tone:",
              "- executiveSummary: 1 paragraph (max 80 words). May embed <strong>...</strong> tags to bold key phrases. Write in the voice of an experienced analyst — what happened, what was decided, what's next.",
              "- meetingPurpose: one short sentence (max 25 words) stating why the meeting was called — the objective in plain language. Skip filler like 'The meeting was held to'; lead with the verb. Examples: 'Onboard the new development team and groom Sprint 15 tickets.' 'Walk the marketing team through the therapist onboarding flow and align on launch readiness.' If the transcript doesn't make the purpose obvious, infer the most likely intent from the opening minutes; never leave this empty.",
              "- keyTakeaways: 4-6 entries summarising the decisions and outcomes a reader needs to know without reading the full minutes. Each entry is { title, detail }: title is a SHORT bold lead-in (2-5 words, Title Case, no trailing colon) such as 'Team Transition', 'Sprint Focus', 'Launch Readiness'; detail is one or two crisp sentences expanding on it. Cover the ENTIRE meeting timeline — at least one takeaway must come from the closing third. Takeaways are neutral statements of fact (not positives or concerns — those have their own sections); think of these as the bullet points an executive briefer would put under 'Key Takeaways'.",
              "- toneBreakdown: { positive, neutral, concerns } each integer 0-100 summing approximately to 100. Use the conversation's emotional tone, not just polite vs blunt language.",
              "- notableQuotes: every verbatim quote that genuinely defined the conversation — do NOT cap at a fixed number; include more for longer meetings and fewer for short ones, based purely on how many truly stood out (omit if none did). Each has { text, speaker, company? }. text must be a real transcript excerpt (max 200 chars). company is optional if known. CRITICAL: pull from the ENTIRE transcript timeline, not just the middle — for any meeting longer than ~10 minutes, the list MUST include at least one quote from the opening third (low indexes near 0), at least one from the closing third (high indexes near the end of the transcript), with the rest spread through the middle. Walk the indexes from start to finish before deciding; never let the selection cluster in one segment of the meeting.",
              "- positives: cover EVERY genuine positive, win, or strong moment raised — { title, detail }. Do NOT force a fixed count; scale with the meeting and omit only if none exist. title is a short bold lead-in (2-6 words); detail is one sentence. CRITICAL: source positives from the ENTIRE meeting timeline (open, middle, and close). Before finalising the list, walk the transcript from start to end and confirm wins discussed in the closing third are represented, not just the opening or middle.",
              "- concerns: cover EVERY material concern raised — same shape. Do not force a fixed count or drop items to stay short; list as many as genuinely surfaced (typically 3-8, more for contentious meetings) and omit only if truly none exist. CRITICAL: source concerns from the ENTIRE meeting timeline. Friction raised late in the meeting (high transcript indexes) is just as important as friction raised early; do not let the list cluster in one third of the conversation.",
              "- momSections: ordered minutes-of-meeting blocks. Each is { index, tag, topic, body }. index references the transcript segment (the number in square brackets) where the topic starts. tag is a 1-2 word category label (e.g. 'Decision', 'Demo', 'Feedback', 'AI Workflow'). topic is a punchy sentence. body is 1-3 sentences in plain text, may include <strong> and <em> tags. CRITICAL: the sections must cover the ENTIRE meeting from start to finish in chronological order — the first section must begin at or near the opening (index 0) and the last section must capture how the meeting ended (closing decisions, wrap-up, next steps discussed at the end). Do not stop partway through; the indexes should progress steadily across the whole transcript with no large unexplained gaps. Emit as many sections as the meeting genuinely needs — never merge distinct topics or skip discussion just to hit a number. Aim for at least 6, and scale up freely for longer meetings (15+ for multi-hour sessions) so every meaningful topic across the full duration is represented.",
              "- actionItems: rewrite the provided action items into { task, detail, owners, due, priority, status }. owners is an ARRAY of the participant name(s) who will actually DO the underlying work — i.e. the people the work belongs to, NOT a manager who merely delegates it. CRITICAL: create ONE action item per distinct task. Resolve ownership to the doers: e.g. 'Assign the Sprint 15 tickets to Chetan and Nirav for development' is really the work 'Develop the Sprint 15 tickets' owned by owners: ['Chetan','Nirav'] (NOT the person assigning); 'Chetan and Nirav will build X' → owners: ['Chetan','Nirav']; 'the backend team — Nirav and Omer — handle Y' → owners: ['Nirav','Omer']. Whenever two or more people share the work, list ALL of them in owners; do NOT duplicate the same task once per person. When only one person is responsible, owners has that single name. If nobody is named, use an empty array. Use exactly the participant names provided. priority must be 'high', 'medium', or 'low'. status must be 'open', 'in_progress', 'planned', or 'done'. due is a short date label (e.g. 'Next standup' or 'YYYY-MM-DD') — leave undefined if not stated in the transcript. detail is one sentence of context.",
              "- topTodos: include EVERY impactful to-do (mostly drawn from actionItems), ordered by urgency. Do NOT cap at a fixed number; scale with the meeting — a 2-hour session naturally yields more than a 10-minute one. Each { title, detail, owner, priority, due }. priority may also be 'critical'. CRITICAL: source to-dos from the ENTIRE meeting timeline. Tasks agreed in the closing third of the transcript are usually the most actionable; never let the list cluster in one segment.",
              "- risks: list EVERY material risk or blocker raised — do not cap at a fixed number or drop items to stay short. Each { severity, title, detail, owner }. severity 'amber' for risks, 'red' for hard blockers. Omit only if truly none exist. CRITICAL: walk the ENTIRE transcript before finalising — blockers surfaced late in the meeting are just as important as those raised early; do not let the list cluster in one segment.",
              "- nextSteps: 3 to 7 forward-looking milestones (typically 3 for a short meeting, more for a long or multi-topic session). Each { period (e.g. 'Tomorrow', 'This Week', 'Next'), title, detail (one sentence) }. The detail of EVERY step must include a concrete calendar date: resolve relative references in the transcript ('Friday', 'next Monday', 'this week', 'end of sprint') against the provided meeting date and write the absolute date inline (e.g. 'by Friday, May 22' or 'starting May 25'). Never leave a step's date implicit. Cover commitments from the WHOLE meeting timeline, not just the closing minutes.",
              "- attendees: list every distinct REAL person who attended as { name }. ONLY include actual people: exclude UI/tool/menu labels and app names that may appear in the participant list (e.g. 'Reframe', 'Backgrounds', 'Gemini', 'Press', 'Take', 'Font', 'Transcribing', 'Adjust', 'Comforce') and collapse possessives onto the person ('Chetan's' is the same person as 'Chetan' — list once). Do NOT emit a role field; the report shows names only.",
              "Quality rules: never invent participants. Never invent quotes. Output must be machine-readable JSON — no markdown fences, no commentary."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Meeting title: ${input.meetingTitle}`,
              `Meeting date: ${formatMeetingDate(input.meetingDate)}`,
              `Duration: ${Math.round(input.durationSeconds)} seconds`,
              `Participants: ${participantList}`,
              `Existing action items (rewrite into actionItems with owners/priority/status):\n${existingActions || "(none)"}`,
              `Existing summary (use as anchor for executiveSummary):\n${input.summary || "(none)"}`,
              "Transcript (lines prefixed with [index] Speaker (start-end): text):",
              indexedTranscript
            ].join("\n\n")
          }
        ],
        "mom_report",
        // The MOM report is several KB of structured JSON. The default 900
        // token cap truncates the response mid-array and the parse fails
        // (we saw "Expected ',' or ']' after array element"). Now that the
        // content fields (momSections/concerns/risks) scale with meeting
        // length, a long multi-hour meeting can produce a much larger report,
        // so we give it more headroom; the repair pass in azureOpenAI.ts still
        // catches the rare overflow.
        { maxCompletionTokens: 12000 }
      );

      const parsed = responseSchema.parse(raw);
      const report = normalizeReport(parsed, input);
      if (!report.executiveSummary.trim()) {
        return {
          ...buildFallbackReport(input, "ai_returned_empty"),
          generationError: "Azure OpenAI returned an empty executiveSummary"
        };
      }
      return { ...report, source: "ai" };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn({ err: error }, "mom report generation failed; using fallback");
      return { ...buildFallbackReport(input, "ai_error"), generationError: message };
    }
  }
}

// Normalize AI output: clamp tone breakdown, resolve momSections.index to
// segment timestamps, drop empty entries.
function normalizeReport(
  parsed: z.infer<typeof responseSchema>,
  input: MomReportInput
): MomReport {
  const tone = parsed.toneBreakdown ?? deriveToneFromSentiment(input.sentimentSummary);
  const positive = clampPct(tone.positive);
  const neutral = clampPct(tone.neutral);
  const concerns = clampPct(tone.concerns);

  const momSections = parsed.momSections
    .map((section) => ({
      ...section,
      index: clampIndex(section.index, input.transcript.length - 1)
    }))
    .filter((section) => section.topic.trim());

  const nextSteps = normalizeNextSteps(
    parsed.nextSteps.filter((n) => n.title.trim()),
    input.meetingDate
  );

  const attendees = normalizeAttendees(
    parsed.attendees.filter((a) => a.name.trim()),
    input.transcript,
    input.participants
  );

  return {
    executiveSummary: parsed.executiveSummary.trim(),
    meetingPurpose: parsed.meetingPurpose?.trim() || undefined,
    keyTakeaways: parsed.keyTakeaways
      .map((t) => ({ title: t.title.trim(), detail: t.detail.trim() }))
      .filter((t) => t.title)
      .slice(0, 8),
    toneBreakdown: { positive, neutral, concerns },
    notableQuotes: parsed.notableQuotes.filter((q) => q.text.trim()).slice(0, 30),
    positives: parsed.positives.filter((p) => p.title.trim()).slice(0, 30),
    // Content fields scale with the meeting — these caps are runaway guards
    // only, set well above any realistic meeting so nothing material is dropped.
    concerns: parsed.concerns.filter((c) => c.title.trim()).slice(0, 25),
    momSections: momSections.slice(0, 50),
    actionItems: normalizeActionItems(parsed.actionItems).slice(0, 40),
    topTodos: parsed.topTodos.filter((t) => t.title.trim()).slice(0, 30),
    risks: parsed.risks.filter((r) => r.title.trim()).slice(0, 20),
    // Allow up to 10 milestones (the prompt asks for 3-7). The renderer
    // switches from 3-card layout to a bullet list whenever count > 3.
    nextSteps: nextSteps.slice(0, 10),
    attendees: attendees.slice(0, 60),
    generatedAt: new Date(),
    source: "ai"
  };
}

// Replace the AI's free-form `period` string with a label derived from the
// absolute date inside each step's `detail` vs the meeting date, then sort by
// urgency so the earliest milestone renders first. The model is already
// required to embed an absolute calendar date in every step's detail (see the
// system prompt's nextSteps rule), so parsing one out is reliable.
type ParsedNextStep = z.infer<typeof responseSchema>["nextSteps"][number];
function normalizeNextSteps(
  steps: ParsedNextStep[],
  meetingDate?: Date
): MomReport["nextSteps"] {
  const enriched = steps.map((step) => {
    const date = parseAbsoluteDate(step.detail) ?? parseAbsoluteDate(step.title);
    return { step, date };
  });

  // Earliest dated step renders first; undated steps fall to the end keeping
  // their relative order from the AI.
  enriched.sort((a, b) => {
    if (a.date && b.date) return a.date.getTime() - b.date.getTime();
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  return enriched.map(({ step, date }) => ({
    period: derivePeriodLabel(date, meetingDate) ?? step.period.trim() ?? "",
    title: step.title.trim(),
    detail: step.detail.trim()
  }));
}

const MONTH_NAMES = [
  "january","february","march","april","may","june",
  "july","august","september","october","november","december"
] as const;
const ABS_DATE_RE = new RegExp(
  `(${MONTH_NAMES.join("|")})\\s+(\\d{1,2})(?:[,\\s]+(\\d{4}))?`,
  "i"
);
function parseAbsoluteDate(text: string | undefined): Date | undefined {
  if (!text) return undefined;
  const match = text.match(ABS_DATE_RE);
  if (!match) return undefined;
  const monthIdx = MONTH_NAMES.findIndex((m) => m === match[1].toLowerCase());
  if (monthIdx < 0) return undefined;
  const day = parseInt(match[2], 10);
  const year = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
  const date = new Date(year, monthIdx, day);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function derivePeriodLabel(target?: Date, meetingDate?: Date): string | undefined {
  if (!target || !meetingDate) return undefined;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(target) - startOfDay(meetingDate)) / 86400000);
  if (days <= 0) return "Today";
  if (days === 1) return "Tomorrow";
  // Sunday=0..Saturday=6. "This week" = anything up to the next Sunday. Within
  // the meeting's own week we surface the weekday name so two near-term steps
  // (e.g. Thursday vs Friday) read distinctly instead of both saying
  // "This Week".
  const daysToSunday = 7 - meetingDate.getDay();
  if (days <= Math.max(2, daysToSunday)) {
    return target.toLocaleDateString("en-US", { weekday: "long" });
  }
  if (days <= daysToSunday + 7) return "Next Week";
  if (days <= 30) return "This Month";
  return "Later";
}

// We deliberately strip the role field — the report shows just the attendee
// list with no Organizer/Participant chip per product direction. Names still
// come from the AI's roster (de-duped + filtered) so we keep its cleanup of
// stray UI labels and possessive variants.
type ParsedAttendee = z.infer<typeof responseSchema>["attendees"][number];
function normalizeAttendees(
  attendees: ParsedAttendee[],
  _transcript: DiarizedTranscriptSegment[],
  fallbackParticipants: Participant[]
): MomReport["attendees"] {
  const source = attendees.length
    ? attendees
    : fallbackParticipants.map((p) => ({ name: p.name }));
  return source
    .filter((a) => a.name.trim())
    .map((a) => ({ name: a.name.trim() }));
}

// Collapse the AI's action items into one entry per distinct task, each with a
// deduped `owners` array. This both normalizes the new `owners` field (folding
// in any legacy single `owner`) and defensively merges items the model may
// still have emitted once-per-person for the same task.
type ParsedActionItem = z.infer<typeof responseSchema>["actionItems"][number];
function normalizeActionItems(items: ParsedActionItem[]): MomReport["actionItems"] {
  const byTask = new Map<string, MomReport["actionItems"][number]>();
  for (const item of items) {
    const task = item.task.trim();
    if (!task) continue;
    const owners = [...(item.owners ?? []), ...(item.owner ? [item.owner] : [])]
      .map((o) => o.trim())
      .filter(Boolean);
    const key = task.toLowerCase();
    const existing = byTask.get(key);
    if (existing) {
      // Same task surfaced again — union the owners onto the first occurrence.
      for (const o of owners) {
        if (!existing.owners!.some((e) => e.toLowerCase() === o.toLowerCase())) {
          existing.owners!.push(o);
        }
      }
      existing.detail = existing.detail || item.detail?.trim() || undefined;
      existing.due = existing.due || item.due?.trim() || undefined;
      existing.priority = existing.priority ?? item.priority;
      existing.status = existing.status ?? item.status;
      continue;
    }
    // Dedupe owners within the single item too.
    const uniqueOwners: string[] = [];
    for (const o of owners) {
      if (!uniqueOwners.some((e) => e.toLowerCase() === o.toLowerCase())) uniqueOwners.push(o);
    }
    byTask.set(key, {
      task,
      detail: item.detail?.trim() || undefined,
      owners: uniqueOwners,
      due: item.due?.trim() || undefined,
      priority: item.priority,
      status: item.status
    });
  }
  return [...byTask.values()];
}

function buildFallbackReport(input: MomReportInput, source: MomReport["source"]): MomReport {
  const tone = deriveToneFromSentiment(input.sentimentSummary);
  return {
    executiveSummary: input.summary || "Meeting transcript was captured. AI summary generation was unavailable for this session.",
    // No structured purpose/takeaways in fallback — frontend falls back to
    // rendering the raw summary paragraph as bullets when these are missing.
    meetingPurpose: undefined,
    keyTakeaways: [],
    toneBreakdown: tone,
    notableQuotes: (input.sentimentSummary?.topMoments ?? [])
      .filter((m) => m.quote)
      .slice(0, 3)
      .map((m) => ({ text: m.quote!, speaker: m.speaker ?? "" })),
    positives: [],
    concerns: [],
    momSections: [],
    actionItems: input.actionItems.map((item) => ({
      task: item.task,
      owners: item.assignee ? [item.assignee] : [],
      priority: "medium",
      status: "open"
    })),
    topTodos: [],
    risks: [],
    nextSteps: [],
    attendees: normalizeAttendees(
      dedupeParticipants(input.participants).map((p) => ({ name: p.name, role: undefined })),
      input.transcript,
      input.participants
    ),
    generatedAt: new Date(),
    source
  };
}

function deriveToneFromSentiment(summary?: SentimentSummary): {
  positive: number;
  neutral: number;
  concerns: number;
} {
  if (!summary) return { positive: 60, neutral: 30, concerns: 10 };
  const score = summary.overall.score;
  // Map score in [-1, 1] to positive% in roughly [25, 90].
  const positive = Math.round(Math.min(90, Math.max(25, 57.5 + score * 32.5)));
  const concerns = Math.round(Math.min(50, Math.max(5, 15 - score * 15)));
  const neutral = Math.max(0, 100 - positive - concerns);
  return { positive, neutral, concerns };
}

function formatMeetingDate(date?: Date): string {
  if (!date || Number.isNaN(date.getTime())) return "unknown";
  // Include the weekday so the model can resolve references like "Friday".
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function clampIndex(value: number, max: number): number {
  if (!Number.isFinite(value) || max < 0) return 0;
  return Math.max(0, Math.min(max, Math.floor(value)));
}

// Drop near-duplicate caption echoes (same speaker + same normalized text seen
// again within a short window). Keeps the FIRST occurrence and remembers its
// original index so the model can still reference back into diarizedTranscript.
const PROMPT_DEDUP_WINDOW_SECONDS = 180;
function dedupeTranscriptForPrompt(
  transcript: DiarizedTranscriptSegment[]
): Array<{ segment: DiarizedTranscriptSegment; originalIndex: number }> {
  const out: Array<{ segment: DiarizedTranscriptSegment; originalIndex: number }> = [];
  const lastSeen = new Map<string, number>();
  transcript.forEach((segment, originalIndex) => {
    const text = (segment.text ?? "").trim();
    if (!text) return;
    const speaker = (segment.speaker ?? "").trim().toLowerCase();
    const key = `${speaker}|${text.toLowerCase()}`;
    const prev = lastSeen.get(key);
    if (prev !== undefined && segment.startTime - prev < PROMPT_DEDUP_WINDOW_SECONDS) {
      return;
    }
    lastSeen.set(key, segment.startTime);
    out.push({ segment, originalIndex });
  });
  return out;
}
