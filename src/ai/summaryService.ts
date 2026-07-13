import { z } from "zod";
import { AzureOpenAIClient } from "./azureOpenAI";
import { env } from "../config/env";
import type {
  ActionItem,
  DiarizedTranscriptSegment,
  MeetingChapter,
  Participant,
  PerSpeakerSentiment,
  SentimentLabel,
  SentimentMoment,
  SentimentSummary
} from "../types/meeting";
import { sentimentLabels } from "../types/meeting";
import type { Logger } from "pino";

const sentimentLabelSchema = z.enum(sentimentLabels);

const segmentSentimentSchema = z.object({
  index: z.number().int().nonnegative(),
  label: sentimentLabelSchema,
  score: z.number().min(-1).max(1)
});

const sentimentMomentSchema = z.object({
  index: z.number().int().nonnegative(),
  label: sentimentLabelSchema,
  score: z.number().min(-1).max(1),
  quote: z.string().optional()
});

const chapterSchema = z.object({
  index: z.number().int().nonnegative(),
  title: z.string()
});

const summarySchema = z.object({
  summary: z.string().default(""),
  shortTitle: z.string().default(""),
  chapters: z.array(chapterSchema).default([]),
  actionItems: z
    .array(
      z.object({
        task: z.string(),
        assignee: z.string().nullable().optional()
      })
    )
    .default([]),
  overallSentiment: z
    .object({
      label: sentimentLabelSchema,
      score: z.number().min(-1).max(1)
    })
    .optional(),
  segmentSentiments: z.array(segmentSentimentSchema).default([]),
  topMoments: z.array(sentimentMomentSchema).default([])
});

export class SummaryService {
  constructor(
    private readonly logger?: Logger,
    private readonly client = new AzureOpenAIClient()
  ) {}

  async summarize(input: { participants: Participant[]; transcript: DiarizedTranscriptSegment[]; transcriptText: string }): Promise<SummaryResult> {
    if (!input.transcriptText.trim()) {
      return { summary: "", shortTitle: undefined, chapters: [], actionItems: [], transcriptWithSentiment: input.transcript, source: "empty_transcript" };
    }

    if (env.ALLOW_MOCK_AI) {
      return {
        summary: "Summary generation skipped because ALLOW_MOCK_AI=true.",
        shortTitle: undefined,
        chapters: [],
        actionItems: [],
        transcriptWithSentiment: input.transcript,
        source: "mock"
      };
    }

    const participantNames = input.participants.map((participant) => participant.name).filter(Boolean);
    const participantList = participantNames.join(", ") || "Unknown";

    // Build a compact, indexed transcript view so the model can reference
    // segments by integer index instead of trying to echo back full text.
    const indexedTranscriptText = input.transcript
      .map((segment, index) => `[${index}] ${segment.speaker} (${segment.startTime.toFixed(2)}–${segment.endTime.toFixed(2)}s): ${segment.text}`)
      .join("\n")
      .slice(0, 120000);

    try {
      const response = await this.client.chatJson<unknown>(
        [
          {
            role: "system",
            content: [
              "You are a meeting intelligence engine.",
              "Return strict JSON only with keys: summary, shortTitle, chapters, actionItems, overallSentiment, segmentSentiments, topMoments.",
              "shortTitle must be a concise 3-8 word title that captures the main topic of the meeting in title case. No trailing punctuation, no quotes, no emojis. Examples: 'Q3 Roadmap Review', 'Onboarding Sync With Pratik', 'Pricing Page Bug Triage'.",
              "chapters is an array of topic bookmarks emitted only when the subject of conversation shifts meaningfully. Each entry is { index, title } where index references the transcript segment (the integer in square brackets at the start of each line) where the new topic begins. Title must be a short (2-6 word) title-case label, no trailing punctuation. Rules: (a) the first chapter's index should usually be 0 if the meeting opens with a clear topic; (b) omit chapters entirely for short meetings (< 5 minutes or < 30 segments) where the topic does not shift; (c) maximum 8 chapters; (d) chapters must be in ascending index order with no duplicates.",
              "actionItems must be an array of { task, assignee }.",
              "Assignee rules:",
              "1. The transcript lines are prefixed with [index] SpeakerName (start–end): text. Use those speaker names as the canonical source of who said what.",
              "2. Set assignee to a participant's exact name (from the provided participants list) when the conversation makes the owner clear — either the task was explicitly given to that participant (e.g. 'Pratik, please do X'), or that participant accepted/committed to the task themselves (e.g. 'I'll take care of X' said by Pratik).",
              "3. Prefer a non-null assignee whenever there is a reasonable, transcript-grounded owner. Only use null when the transcript truly does not indicate anyone responsible.",
              "4. Never invent participants or tasks. Never assign a task to someone who is not in the participants list.",
              "5. Do not include tasks that were only hypothetical, joking, or clearly resolved during the meeting.",
              "Sentiment rules:",
              "A. overallSentiment is the meeting-level mood. label is one of positive, neutral, negative. score is a number in [-1, 1] where -1 is very negative and 1 is very positive.",
              "B. segmentSentiments must contain one entry per transcript segment, addressed by its integer index (the number in square brackets at the start of each line). Each entry has the same label + score fields. Score reflects the affect of THAT line in context — assertive/upbeat lines are positive, frustrated/dismissive/conflict lines are negative, factual/procedural lines are neutral (score near 0).",
              "C. topMoments is a short array (max 5) of the most emotionally salient segments — pick lines where the score magnitude is highest or that shift the conversation. Each entry references the segment by index, includes label + score, and optionally a quote (a short verbatim excerpt; <= 140 chars).",
              "D. Be consistent: a segment in topMoments must have the same label + score as its entry in segmentSentiments."
            ].join(" ")
          },
          {
            role: "user",
            content: [
              `Participants: ${participantList}`,
              `Number of transcript segments: ${input.transcript.length}`,
              "Transcript (lines are prefixed with [index] SpeakerName (start–end): text):",
              indexedTranscriptText
            ].join("\n")
          }
        ],
        "summary",
        // The summary emits one sentiment entry PER segment plus the summary,
        // action items, chapters and moments — output scales with the meeting.
        // On reasoning deployments reasoning tokens also come out of this budget,
        // so give it generous, segment-scaled headroom (a too-small cap returns
        // empty content and drops the whole meeting to the fallback summary).
        { maxCompletionTokens: Math.min(16000, 6000 + input.transcript.length * 40) }
      );

      const parsed = summarySchema.parse(response);
      const participantSet = new Set(participantNames.map((name) => name.toLocaleLowerCase("en-US")));
      const sanitizedActionItems = parsed.actionItems.map((item) => {
        const assignee = item.assignee?.trim();
        if (!assignee || !participantSet.has(assignee.toLocaleLowerCase("en-US"))) {
          return { task: item.task, assignee: null };
        }
        const canonical = participantNames.find((name) => name.toLocaleLowerCase("en-US") === assignee.toLocaleLowerCase("en-US")) ?? assignee;
        return { task: item.task, assignee: canonical };
      });

      const transcriptWithSentiment = mergeSegmentSentiments(input.transcript, parsed.segmentSentiments);
      const sentimentSummary = buildSentimentSummary(transcriptWithSentiment, parsed.overallSentiment, parsed.topMoments);
      const chapters = sanitizeChapters(parsed.chapters, input.transcript);

      if (!parsed.summary.trim()) {
        const fallback = fallbackSummary(input);
        return {
          ...fallback,
          chapters,
          transcriptWithSentiment,
          sentimentSummary,
          source: "ai_returned_empty",
          generationError: "Azure OpenAI returned an empty summary string"
        };
      }

      return {
        summary: parsed.summary,
        shortTitle: normalizeShortTitle(parsed.shortTitle) ?? deriveShortTitleFromSummary(parsed.summary),
        chapters,
        actionItems: sanitizedActionItems,
        transcriptWithSentiment,
        sentimentSummary,
        source: "ai"
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger?.warn({ err: error }, "summary generation failed; using deterministic fallback summary");
      const fallback = fallbackSummary(input);
      return {
        ...fallback,
        chapters: [],
        transcriptWithSentiment: input.transcript,
        source: "ai_error",
        generationError: message
      };
    }
  }
}

export interface SummaryResult {
  summary: string;
  // Concise 3-8 word title derived from the AI summary. Undefined when the
  // transcript was empty or the AI call failed before producing a title.
  shortTitle?: string;
  // Topic chapters keyed to segment timestamps. Empty array means the AI
  // decided no topic shift was significant enough to bookmark (short meeting,
  // single subject, AI fallback path).
  chapters: MeetingChapter[];
  actionItems: ActionItem[];
  // Diarized segments augmented with per-segment sentiment. When the AI call
  // fails this is the input transcript unchanged.
  transcriptWithSentiment: DiarizedTranscriptSegment[];
  sentimentSummary?: SentimentSummary;
  // Provenance of the returned summary. `ai` is the only success state — every
  // other value means the orchestrator should log a warning and the user
  // should investigate (config, quota, transcript content).
  source: "ai" | "ai_error" | "ai_returned_empty" | "mock" | "empty_transcript";
  generationError?: string;
}

function mergeSegmentSentiments(
  transcript: DiarizedTranscriptSegment[],
  segmentSentiments: Array<{ index: number; label: SentimentLabel; score: number }>
): DiarizedTranscriptSegment[] {
  if (segmentSentiments.length === 0) return transcript;
  const byIndex = new Map<number, { label: SentimentLabel; score: number }>();
  for (const entry of segmentSentiments) {
    if (entry.index < 0 || entry.index >= transcript.length) continue;
    byIndex.set(entry.index, { label: entry.label, score: clampScore(entry.score) });
  }
  return transcript.map((segment, index) => {
    const sentiment = byIndex.get(index);
    if (!sentiment) return segment;
    return { ...segment, sentiment };
  });
}

function buildSentimentSummary(
  transcript: DiarizedTranscriptSegment[],
  overall: { label: SentimentLabel; score: number } | undefined,
  topMoments: Array<{ index: number; label: SentimentLabel; score: number; quote?: string }>
): SentimentSummary | undefined {
  const segmentsWithSentiment = transcript.filter((segment) => segment.sentiment !== undefined);
  if (segmentsWithSentiment.length === 0 && !overall) return undefined;

  // Derive overall from segments when the model didn't provide one. The
  // segment-average is a useful sanity-check fallback.
  const derivedOverallScore = segmentsWithSentiment.length > 0
    ? segmentsWithSentiment.reduce((sum, segment) => sum + (segment.sentiment?.score ?? 0), 0) / segmentsWithSentiment.length
    : 0;
  const overallSentiment = overall
    ? { label: overall.label, score: clampScore(overall.score) }
    : { label: scoreToLabel(derivedOverallScore), score: clampScore(derivedOverallScore) };

  const perSpeaker = aggregatePerSpeaker(segmentsWithSentiment);
  const moments: SentimentMoment[] = topMoments
    .map((moment): SentimentMoment | null => {
      const segment = transcript[moment.index];
      if (!segment) return null;
      return {
        startTime: segment.startTime,
        endTime: segment.endTime,
        label: moment.label,
        score: clampScore(moment.score),
        quote: moment.quote?.slice(0, 200) ?? segment.text.slice(0, 200),
        speaker: segment.speaker
      };
    })
    .filter((moment): moment is SentimentMoment => moment !== null)
    .slice(0, 5);

  return {
    overall: overallSentiment,
    perSpeaker,
    topMoments: moments
  };
}

function aggregatePerSpeaker(segments: DiarizedTranscriptSegment[]): PerSpeakerSentiment[] {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const segment of segments) {
    if (!segment.sentiment) continue;
    const bucket = buckets.get(segment.speaker) ?? { sum: 0, count: 0 };
    bucket.sum += segment.sentiment.score;
    bucket.count += 1;
    buckets.set(segment.speaker, bucket);
  }
  return [...buckets.entries()]
    .map(([speaker, bucket]) => {
      const avg = bucket.sum / bucket.count;
      return {
        speaker,
        label: scoreToLabel(avg),
        score: clampScore(avg),
        segmentCount: bucket.count
      };
    })
    .sort((a, b) => b.segmentCount - a.segmentCount);
}

function scoreToLabel(score: number): SentimentLabel {
  if (score >= 0.2) return "positive";
  if (score <= -0.2) return "negative";
  return "neutral";
}

function clampScore(score: number): number {
  if (Number.isNaN(score)) return 0;
  return Math.max(-1, Math.min(1, score));
}

function fallbackSummary(input: { participants: Participant[]; transcript: DiarizedTranscriptSegment[]; transcriptText: string }): {
  summary: string;
  shortTitle?: string;
  actionItems: ActionItem[];
} {
  const participantNames = input.participants.map((participant) => participant.name).filter(Boolean);
  const speakerNames = [...new Set(input.transcript.map((segment) => segment.speaker).filter(Boolean))];
  const names = participantNames.length > 0 ? participantNames : speakerNames;
  const duration = input.transcript.length > 0 ? Math.max(...input.transcript.map((segment) => segment.endTime)) : 0;
  const minutes = Math.max(1, Math.round(duration / 60));
  const prefix = names.length > 0 ? `Meeting with ${names.join(", ")}` : "Meeting";
  const shortTitle = names.length > 0
    ? `Meeting with ${names.slice(0, 2).join(" & ")}`
    : "Untitled Meeting";
  return {
    summary: `${prefix} was transcribed successfully. AI summary generation was unavailable, so this fallback summary was generated from the transcript metadata (${input.transcript.length} segments, about ${minutes} minute${minutes === 1 ? "" : "s"}).`,
    shortTitle,
    actionItems: []
  };
}

// Clean up the model's shortTitle output: strip quotes, trailing punctuation,
// collapse whitespace, cap at 8 words / 80 chars. Returns undefined when the
// model returned nothing useful so callers can fall back to summary-derived
// titles.
function normalizeShortTitle(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  let cleaned = raw.replace(/\s+/g, " ").trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "");
  cleaned = cleaned.replace(/[.!?,;:\-–—]+$/g, "").trim();
  if (!cleaned) return undefined;
  const words = cleaned.split(" ");
  if (words.length > 8) cleaned = words.slice(0, 8).join(" ");
  if (cleaned.length > 80) cleaned = cleaned.slice(0, 80).trim();
  return cleaned;
}

// Last-resort title when the AI omits one: take the first sentence of the
// summary, drop trailing punctuation, cap to ~8 words. Keeps the list view
// from showing the raw multi-sentence summary as the row title.
function deriveShortTitleFromSummary(summary: string): string | undefined {
  const firstSentence = summary.split(/(?<=[.!?])\s+/)[0];
  return normalizeShortTitle(firstSentence);
}

// Resolve segment-indexed chapters to wall-clock startTimes, dedupe by index,
// keep ascending order, cap to 8 entries. Returns [] when the AI returned no
// usable chapters so the UI can hide the section cleanly.
function sanitizeChapters(
  raw: Array<{ index: number; title: string }>,
  transcript: DiarizedTranscriptSegment[]
): MeetingChapter[] {
  if (raw.length === 0 || transcript.length === 0) return [];
  const seenIndex = new Set<number>();
  const chapters: MeetingChapter[] = [];
  for (const entry of raw) {
    if (entry.index < 0 || entry.index >= transcript.length) continue;
    if (seenIndex.has(entry.index)) continue;
    const title = entry.title?.trim();
    if (!title) continue;
    seenIndex.add(entry.index);
    chapters.push({
      title: title.replace(/[.!?,;:]+$/g, "").slice(0, 80),
      startTime: transcript[entry.index].startTime
    });
  }
  chapters.sort((a, b) => a.startTime - b.startTime);
  return chapters.slice(0, 8);
}
