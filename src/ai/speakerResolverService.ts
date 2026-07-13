import { z } from "zod";
import { AzureOpenAIClient } from "./azureOpenAI";
import { env } from "../config/env";
import { cleanParticipantName } from "../processing/participants";
import type { CaptionTimelineEntry, DiarizedTranscriptSegment, Participant } from "../types/meeting";
import type { Logger } from "pino";

const resolverResponseSchema = z.object({
  mappings: z
    .array(
      z.object({
        clusterId: z.string().min(1),
        speaker: z.string().min(1),
        confidence: z.number().min(0).max(1),
        reason: z.string().default("")
      })
    )
    .default([])
});

type ResolverMapping = z.infer<typeof resolverResponseSchema>["mappings"][number];

interface ResolveInput {
  participants: Participant[];
  diarizedTranscript: DiarizedTranscriptSegment[];
  captionsTimeline: CaptionTimelineEntry[];
  currentTranscript: DiarizedTranscriptSegment[];
  meetingStartedAt?: Date;
}

interface CurrentMapping {
  clusterId: string;
  speaker: string;
  confidence: number;
  locked: boolean;
}

export class SpeakerResolverService {
  constructor(
    private readonly logger: Logger,
    private readonly client = new AzureOpenAIClient()
  ) {}

  async resolve(input: ResolveInput): Promise<DiarizedTranscriptSegment[]> {
    if (!env.SPEAKER_RESOLVER_ENABLED || env.ALLOW_MOCK_AI) return input.currentTranscript;
    if (input.diarizedTranscript.length === 0 || input.currentTranscript.length === 0) return input.currentTranscript;

    const participantNames = uniqueParticipantNames(input.participants);
    if (participantNames.length === 0) return input.currentTranscript;

    const currentMappings = summarizeCurrentMappings(input.currentTranscript, participantNames);
    const lockedClusterIds = new Set(currentMappings.filter((mapping) => mapping.locked).map((mapping) => mapping.clusterId));

    try {
      const response = await this.client.chatJson<unknown>(
        [
          {
            role: "system",
            content: [
              "You are a conservative meeting speaker identity resolver.",
              "Diarization clusters are the final transcript source; do not rewrite transcript text or timestamps.",
              "Caption labels are weak timed hints only. They may be wrong for Gujarati, Hindi, English code-mix, and translated captions.",
              "Only map a cluster to one of the provided participant names when evidence is strong.",
              "Return strict JSON only: {\"mappings\":[{\"clusterId\":\"...\",\"speaker\":\"...\",\"confidence\":0.0,\"reason\":\"...\"}]}",
              "Use confidence below 0.75 when unsure. Do not invent names."
            ].join(" ")
          },
          {
            role: "user",
            content: JSON.stringify({
              participants: participantNames,
              diarizedTranscript: summarizeClusters(input.diarizedTranscript),
              captionHints: summarizeCaptionHints(input.captionsTimeline, participantNames, input.meetingStartedAt),
              currentMappings
            })
          }
        ],
        "speaker resolver"
      );

      const parsed = resolverResponseSchema.parse(response);
      const resolved = applyResolverMappings(input.currentTranscript, parsed.mappings, participantNames, lockedClusterIds);

      this.logger.info(
        {
          hardThreshold: env.SPEAKER_RESOLVER_CONFIDENCE_THRESHOLD,
          softThreshold: env.SPEAKER_RESOLVER_SOFT_CONFIDENCE_THRESHOLD,
          mappings: parsed.mappings.map((mapping) => ({
            clusterId: mapping.clusterId,
            speaker: mapping.speaker,
            confidence: mapping.confidence,
            appliedAs: resolved.accepted.get(mapping.clusterId)?.tier ?? "rejected",
            reason: mapping.reason
          })),
          // Assignments the model did not name directly (soft-accepted or filled in
          // by last-one-standing elimination) — surfaced so the choice is auditable.
          derivedAssignments: [...resolved.accepted.entries()]
            .filter(([, mapping]) => mapping.tier !== "confident")
            .map(([clusterId, mapping]) => ({ clusterId, speaker: mapping.speaker, confidence: mapping.confidence, tier: mapping.tier }))
        },
        "llm speaker resolver decisions"
      );

      return resolved.transcript;
    } catch (error) {
      this.logger.warn({ err: error }, "llm speaker resolver failed; keeping deterministic speaker labels");
      return input.currentTranscript;
    }
  }
}

function uniqueParticipantNames(participants: Participant[]): string[] {
  const names = new Map<string, string>();
  for (const participant of participants) {
    const cleaned = cleanParticipantName(participant.name);
    if (!cleaned) continue;
    names.set(cleaned.toLocaleLowerCase("en-US"), cleaned);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b));
}

function summarizeClusters(transcript: DiarizedTranscriptSegment[]): Array<{
  clusterId: string;
  firstStartTime: number;
  lastEndTime: number;
  totalDuration: number;
  segments: Array<{ startTime: number; endTime: number; text: string }>;
}> {
  const clusters = new Map<string, DiarizedTranscriptSegment[]>();
  for (const segment of transcript) {
    const clusterId = segmentClusterId(segment);
    clusters.set(clusterId, [...(clusters.get(clusterId) ?? []), segment]);
  }

  return [...clusters.entries()]
    .map(([clusterId, segments]) => {
      const ordered = [...segments].sort((a, b) => a.startTime - b.startTime);
      return {
        clusterId,
        firstStartTime: roundSeconds(ordered[0]?.startTime ?? 0),
        lastEndTime: roundSeconds(ordered[ordered.length - 1]?.endTime ?? 0),
        totalDuration: roundSeconds(ordered.reduce((sum, segment) => sum + Math.max(0, segment.endTime - segment.startTime), 0)),
        segments: ordered.slice(0, 40).map((segment) => ({
          startTime: roundSeconds(segment.startTime),
          endTime: roundSeconds(segment.endTime),
          text: segment.text.slice(0, 700)
        }))
      };
    })
    .sort((a, b) => b.totalDuration - a.totalDuration || a.firstStartTime - b.firstStartTime);
}

function summarizeCaptionHints(
  captions: CaptionTimelineEntry[],
  participantNames: string[],
  meetingStartedAt?: Date
): Array<{ speaker: string; timeOffsetSeconds?: number; text: string }> {
  const participantSet = new Set(participantNames.map((name) => name.toLocaleLowerCase("en-US")));
  const referenceTime = meetingStartedAt?.getTime() ?? captions[0]?.time.getTime();
  const hints: Array<{ speaker: string; timeOffsetSeconds?: number; text: string }> = [];

  for (const caption of captions) {
    const speaker = cleanParticipantName(caption.speaker);
    if (!speaker || !participantSet.has(speaker.toLocaleLowerCase("en-US"))) continue;

    const hint: { speaker: string; timeOffsetSeconds?: number; text: string } = {
      speaker,
      text: caption.text.slice(0, 500)
    };
    if (referenceTime) hint.timeOffsetSeconds = roundSeconds((caption.time.getTime() - referenceTime) / 1000);
    hints.push(hint);
  }

  return hints.slice(-160);
}

function summarizeCurrentMappings(transcript: DiarizedTranscriptSegment[], participantNames: string[]): CurrentMapping[] {
  const participantSet = new Set(participantNames.map((name) => name.toLocaleLowerCase("en-US")));
  const byCluster = new Map<string, DiarizedTranscriptSegment[]>();

  for (const segment of transcript) {
    const clusterId = segmentClusterId(segment);
    byCluster.set(clusterId, [...(byCluster.get(clusterId) ?? []), segment]);
  }

  return [...byCluster.entries()]
    .map(([clusterId, segments]) => {
      const speaker = dominantSpeaker(segments);
      const confidenceValues = segments.map((segment) => segment.confidence).filter((value): value is number => typeof value === "number");
      const confidence = confidenceValues.length > 0 ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0.3;
      const cleanedSpeaker = cleanParticipantName(speaker);
      return {
        clusterId,
        speaker,
        confidence: roundSeconds(confidence),
        locked: Boolean(cleanedSpeaker && participantSet.has(cleanedSpeaker.toLocaleLowerCase("en-US")) && confidence >= 0.95)
      };
    })
    .sort((a, b) => a.clusterId.localeCompare(b.clusterId));
}

interface AcceptedMapping {
  speaker: string;
  confidence: number;
  tier: "confident" | "soft" | "elimination";
}

function applyResolverMappings(
  transcript: DiarizedTranscriptSegment[],
  mappings: ResolverMapping[],
  participantNames: string[],
  lockedClusterIds: Set<string>
): { transcript: DiarizedTranscriptSegment[]; accepted: Map<string, AcceptedMapping> } {
  const participantsByKey = new Map(participantNames.map((name) => [name.toLocaleLowerCase("en-US"), name]));
  const canonical = (name: string): string | undefined => {
    const cleaned = cleanParticipantName(name);
    return cleaned ? participantsByKey.get(cleaned.toLocaleLowerCase("en-US")) : undefined;
  };

  // Cluster order + the name each cluster already carries from the deterministic
  // stage, so we can tell which clusters/names are still free.
  const clusterOrder: string[] = [];
  const currentSpeakerByCluster = new Map<string, string>();
  {
    const byCluster = new Map<string, DiarizedTranscriptSegment[]>();
    for (const segment of transcript) {
      const clusterId = segmentClusterId(segment);
      if (!byCluster.has(clusterId)) clusterOrder.push(clusterId);
      byCluster.set(clusterId, [...(byCluster.get(clusterId) ?? []), segment]);
    }
    for (const [clusterId, segments] of byCluster) currentSpeakerByCluster.set(clusterId, dominantSpeaker(segments));
  }

  // Best (highest-confidence) proposal per cluster; locked clusters are untouchable.
  const bestByCluster = new Map<string, { speaker: string; confidence: number }>();
  for (const mapping of mappings) {
    if (lockedClusterIds.has(mapping.clusterId)) continue;
    const canonicalSpeaker = canonical(mapping.speaker);
    if (!canonicalSpeaker) continue;
    const existing = bestByCluster.get(mapping.clusterId);
    if (!existing || mapping.confidence > existing.confidence) {
      bestByCluster.set(mapping.clusterId, { speaker: canonicalSpeaker, confidence: mapping.confidence });
    }
  }

  const accepted = new Map<string, AcceptedMapping>();
  const usedNames = new Set<string>();

  // A name is already spoken for if it sits on a locked cluster, or on a cluster
  // the resolver will not touch (no proposal) — either way it can't be reused.
  for (const clusterId of clusterOrder) {
    const canonicalCurrent = canonical(currentSpeakerByCluster.get(clusterId) ?? "");
    if (canonicalCurrent && (lockedClusterIds.has(clusterId) || !bestByCluster.has(clusterId))) {
      usedNames.add(canonicalCurrent.toLocaleLowerCase("en-US"));
    }
  }

  const proposals = [...bestByCluster.entries()]
    .map(([clusterId, proposal]) => ({ clusterId, ...proposal }))
    .sort((a, b) => b.confidence - a.confidence);

  const hard = env.SPEAKER_RESOLVER_CONFIDENCE_THRESHOLD;
  const soft = Math.min(env.SPEAKER_RESOLVER_SOFT_CONFIDENCE_THRESHOLD, hard);

  const claim = (clusterId: string, speaker: string, confidence: number, tier: AcceptedMapping["tier"]): void => {
    accepted.set(clusterId, { speaker, confidence, tier });
    usedNames.add(speaker.toLocaleLowerCase("en-US"));
  };

  // Tier 1 — confident: at/above the hard threshold, highest-confidence first so a
  // contested name lands on the cluster most sure of it.
  for (const proposal of proposals) {
    if (proposal.confidence < hard) continue;
    if (usedNames.has(proposal.speaker.toLocaleLowerCase("en-US"))) continue;
    claim(proposal.clusterId, proposal.speaker, proposal.confidence, "confident");
  }

  // Tier 2 — soft: a below-threshold guess still wins its name if no more confident
  // cluster already took it. Recovers "probably Ashok" instead of leaving it blank.
  for (const proposal of proposals) {
    if (accepted.has(proposal.clusterId)) continue;
    if (proposal.confidence < soft || proposal.confidence >= hard) continue;
    if (usedNames.has(proposal.speaker.toLocaleLowerCase("en-US"))) continue;
    claim(proposal.clusterId, proposal.speaker, proposal.confidence, "soft");
  }

  // Tier 3 — elimination: when exactly one cluster is still unnamed and exactly one
  // participant is still unused, they can only be each other.
  const finalSpeaker = (clusterId: string): string => accepted.get(clusterId)?.speaker ?? currentSpeakerByCluster.get(clusterId) ?? "";
  const unnamedClusters = clusterOrder.filter((clusterId) => !canonical(finalSpeaker(clusterId)));
  const unusedNames = participantNames.filter((name) => !usedNames.has(name.toLocaleLowerCase("en-US")));
  if (unnamedClusters.length === 1 && unusedNames.length === 1) {
    claim(unnamedClusters[0], unusedNames[0], hard, "elimination");
  }

  return {
    accepted,
    transcript: transcript.map((segment) => {
      const mapping = accepted.get(segmentClusterId(segment));
      if (!mapping) return segment;
      return {
        ...segment,
        speaker: mapping.speaker,
        confidence: typeof segment.confidence === "number" ? Math.min(segment.confidence, mapping.confidence) : mapping.confidence
      };
    })
  };
}

function dominantSpeaker(segments: DiarizedTranscriptSegment[]): string {
  const durations = new Map<string, number>();
  for (const segment of segments) {
    durations.set(segment.speaker, (durations.get(segment.speaker) ?? 0) + Math.max(0, segment.endTime - segment.startTime));
  }
  return [...durations.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? "Speaker A";
}

function segmentClusterId(segment: DiarizedTranscriptSegment): string {
  return (segment.clusterId ?? segment.speaker).replace(/\s+/g, " ").trim() || "Speaker A";
}

function roundSeconds(value: number): number {
  return Math.round(value * 100) / 100;
}
