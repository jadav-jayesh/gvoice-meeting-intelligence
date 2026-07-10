import { env } from "../config/env";
import { cleanParticipantName } from "./participants";
import type { CaptionTimelineEntry, DiarizedTranscriptSegment, Participant, ParticipantTimelineEntry } from "../types/meeting";
import type { Logger } from "pino";

interface MappingDecision {
  cluster: string;
  mappedSpeaker: string;
  confidence: number;
  reason: string;
}

// Caption evidence required for a cluster→participant assignment. A single
// stray caption (e.g. a Teams roster panel artifact that briefly looked like
// "Pratik: Ruchit") must not be enough to attribute a whole cluster of speech
// to a participant who never spoke.
const MIN_SUPPORTING_CAPTION_MATCHES = 2;
const MIN_WINNING_FRACTION = 0.6;

export function mapSpeakersToParticipants(
  transcript: DiarizedTranscriptSegment[],
  participants: Participant[],
  captions: CaptionTimelineEntry[],
  logger: Logger,
  meetingStartedAt?: Date,
  participantsTimeline: ParticipantTimelineEntry[] = []
): DiarizedTranscriptSegment[] {
  if (transcript.length === 0) return [];

  const realParticipants = participants
    .map((participant) => cleanParticipantName(participant.name))
    .filter((name): name is string => Boolean(name));

  // Single-participant meetings: diarisers (pyannote especially) routinely
  // over-segment ONE voice into several clusters (SPEAKER_00/01…). With exactly
  // one known participant every cluster is unambiguously that person, so assign
  // all segments to them and skip the multi-cluster evidence/elimination logic —
  // which would otherwise leave a low-confidence extra cluster as a generic
  // "Speaker A" (the bug seen on the single-Ruchit Teams session).
  const uniqueParticipants = [...new Map(realParticipants.map((name) => [name.toLocaleLowerCase("en-US"), name])).values()];
  if (uniqueParticipants.length === 1) {
    const soleSpeaker = uniqueParticipants[0];
    const clusterCount = new Set(transcript.map((segment) => segment.clusterId ?? segment.speaker)).size;
    logger.info({ soleSpeaker, clusterCount }, "speaker mapping: single known participant — assigning all clusters to them");
    return transcript.map((segment) => ({ ...segment, speaker: soleSpeaker }));
  }

  const participantSet = new Set(realParticipants.map((name) => name.toLocaleLowerCase("en-US")));
  const filteredCaptions = filterRosterArtifactCaptions(captions, realParticipants);

  const clusters = calculateClusterDurations(transcript);
  const decisions = new Map<string, MappingDecision>();
  const usedParticipants = new Set<string>();

  for (const cluster of clusters) {
    const cleanedClusterName = cleanParticipantName(cluster.name);
    if (cleanedClusterName && participantSet.has(cleanedClusterName.toLocaleLowerCase("en-US"))) {
      decisions.set(cluster.name, {
        cluster: cluster.name,
        mappedSpeaker: cleanedClusterName,
        confidence: 1,
        reason: "provider emitted participant name"
      });
      usedParticipants.add(cleanedClusterName.toLocaleLowerCase("en-US"));
    }
  }

  const captionScores = scoreCaptionHints(transcript, filteredCaptions, participantSet, meetingStartedAt);

  // Detect biased captions: when EVERY cluster's strongest caption hint points
  // to the SAME participant (despite 2+ participants existing), the caption
  // labels are unreliable — typically Google Meet's rolling caption where one
  // speaker name is reused across interleaved turns.
  //
  // We only consider UN-DECIDED clusters here. Clusters that the initial pass
  // already locked (because the diariser emitted a real participant name as
  // the cluster label) carry no signal about caption reliability — their top
  // hint is trivially the participant they're already mapped to. Including
  // them inflates the "all clusters point at the same person" signature and
  // suppresses legitimate single-cluster Phase A evidence (the bug seen on
  // the Vraj/Ruchit + leftover "Speaker B" case).
  const unmappedCaptionScores = new Map(
    [...captionScores.entries()].filter(([cluster]) => !decisions.has(cluster))
  );
  const captionsBiased = detectCaptionBias(unmappedCaptionScores, realParticipants);
  if (captionsBiased) {
    logger.warn(
      {
        scores: [...captionScores.entries()].map(([cluster, scoresMap]) => ({
          cluster,
          scores: [...scoresMap.entries()].map(([participant, score]) => ({
            participant,
            score
          }))
        }))
      },
      "speaker mapping: caption hints all favour one participant — falling back to join-order elimination"
    );
  }

  // Phase A — best-cluster-per-participant (1:1, evidence-driven).
  // Build per-cluster totals for fraction calculations.
  const clusterTotals = new Map<string, number>();
  for (const [clusterName, scoresMap] of captionScores.entries()) {
    clusterTotals.set(clusterName, [...scoresMap.values()].reduce((sum, value) => sum + value, 0));
  }

  // Index participantKey → canonical name.
  const participantsByKey = new Map<string, string>();
  for (const name of realParticipants) {
    participantsByKey.set(name.toLocaleLowerCase("en-US"), name);
  }

  // Build all (participant, cluster, score) pairs that aren't already locked by
  // the provider-name path, then assign greedily by descending score under a
  // 1:1 constraint. This guarantees each participant who has any caption
  // evidence claims their strongest cluster — even if that cluster's top
  // candidate happened to be a different (dominant) speaker. That fixes the
  // "Sagar dominates captions, Ruchit's lone caption is ignored" case.
  type CaptionPair = { participantKey: string; cluster: string; score: number };
  const allPairs: CaptionPair[] = [];
  if (!captionsBiased) {
    for (const [clusterName, scoresMap] of captionScores.entries()) {
      if (decisions.has(clusterName)) continue;
      for (const [partName, score] of scoresMap.entries()) {
        const partKey = partName.toLocaleLowerCase("en-US");
        if (usedParticipants.has(partKey)) continue;
        if (score < 1) continue;
        allPairs.push({ participantKey: partKey, cluster: clusterName, score });
      }
    }
  }
  allPairs.sort((a, b) => b.score - a.score || a.cluster.localeCompare(b.cluster));

  for (const pair of allPairs) {
    if (decisions.has(pair.cluster)) continue;
    if (usedParticipants.has(pair.participantKey)) continue;

    const totalForCluster = clusterTotals.get(pair.cluster) ?? pair.score;
    const fraction = totalForCluster > 0 ? pair.score / totalForCluster : 0;
    const canonical = participantsByKey.get(pair.participantKey) ?? pair.participantKey;

    decisions.set(pair.cluster, {
      cluster: pair.cluster,
      mappedSpeaker: canonical,
      confidence: Math.min(0.9, Math.max(0.75, 0.5 + fraction * 0.4)),
      reason: `caption evidence 1:1 (${pair.score.toFixed(1)} matches, ${(fraction * 100).toFixed(0)}% of cluster)`
    });
    usedParticipants.add(pair.participantKey);
  }

  // Phase B — share an already-claimed participant with remaining clusters
  // when the cluster's caption evidence is overwhelmingly dominated by that
  // participant. This handles the diarization-split case where one speaker is
  // fragmented across multiple clusters (e.g. due to code-switching between
  // English and Gujarati shifting acoustic features).
  for (const [clusterName, scoresMap] of captionScores.entries()) {
    if (captionsBiased) break;
    if (decisions.has(clusterName)) continue;
    const totalForCluster = clusterTotals.get(clusterName) ?? 0;
    if (totalForCluster < MIN_SUPPORTING_CAPTION_MATCHES) continue;

    const ranked = [...scoresMap.entries()].sort((a, b) => b[1] - a[1]);
    const [topPart, topScore] = ranked[0] ?? [];
    if (!topPart) continue;

    const fraction = totalForCluster > 0 ? topScore / totalForCluster : 0;
    if (topScore < MIN_SUPPORTING_CAPTION_MATCHES) continue;
    if (fraction < MIN_WINNING_FRACTION) continue;

    const canonical = participantsByKey.get(topPart.toLocaleLowerCase("en-US")) ?? topPart;
    decisions.set(clusterName, {
      cluster: clusterName,
      mappedSpeaker: canonical,
      confidence: Math.min(0.85, Math.max(env.SPEAKER_MAPPING_CONFIDENCE_THRESHOLD, fraction)),
      reason: `caption evidence shared (${topScore.toFixed(1)} matches, ${(fraction * 100).toFixed(0)}% of cluster)`
    });
  }

  // Phase C — process of elimination.
  //
  // Two sub-cases:
  //   (1) Strict 1==1 — original Teams behaviour. If captions provided some
  //       evidence and exactly one cluster + one participant remain unmapped,
  //       bind them. This was the only fallback before and is preserved
  //       unchanged so the Teams flow behaves identically.
  //   (2) N==N when there was *no* caption evidence at all. This is the
  //       only pathway that produces real names for platforms that surface
  //       zero captions (Zoom WC in particular). Gated on captions being
  //       effectively empty so it cannot trigger on a Teams session where
  //       captions exist and Phases A/B have already done partial mapping —
  //       in that scenario, leftover clusters might rightfully not match
  //       unclaimed participants (the participants may have been silent).
  const unmappedClusters = clusters.filter((cluster) => !decisions.has(cluster.name));
  const unclaimedParticipants = realParticipants.filter(
    (name) => !usedParticipants.has(name.toLocaleLowerCase("en-US"))
  );
  // Treat biased captions the same as "no captions at all" so the N==N
  // join-order elimination path can run.
  const hadCaptionEvidence = !captionsBiased && filteredCaptions.length > 0;

  if (unmappedClusters.length === 1 && unclaimedParticipants.length === 1) {
    // Sub-case (1): strict 1==1 fallback (preserves prior Teams behaviour).
    const cluster = unmappedClusters[0];
    const participant = unclaimedParticipants[0];
    decisions.set(cluster.name, {
      cluster: cluster.name,
      mappedSpeaker: participant,
      confidence: 0.7,
      reason: "process of elimination — only remaining unmapped cluster and unclaimed participant"
    });
    usedParticipants.add(participant.toLocaleLowerCase("en-US"));
    logger.info(
      { cluster: cluster.name, participant },
      "speaker mapping: assigned last unmapped cluster to last unclaimed participant by elimination"
    );
  } else if (
    !hadCaptionEvidence &&
    unmappedClusters.length > 1 &&
    unmappedClusters.length === unclaimedParticipants.length
  ) {
    // Sub-case (2): N==N elimination when no captions were available at all
    // (the Zoom-without-captions case).
    const orderedClusters = orderClustersByFirstAppearance(transcript, unmappedClusters);
    const orderedParticipants = orderParticipantsByJoinTime(unclaimedParticipants, participantsTimeline);

    for (let index = 0; index < orderedClusters.length; index += 1) {
      const cluster = orderedClusters[index];
      const participant = orderedParticipants[index];
      if (!cluster || !participant) continue;

      decisions.set(cluster.name, {
        cluster: cluster.name,
        mappedSpeaker: participant,
        confidence: 0.55,
        reason: `process of elimination (no captions) — ${unmappedClusters.length} clusters matched 1:1 to ${unmappedClusters.length} unclaimed participants by appearance/join order`
      });
      usedParticipants.add(participant.toLocaleLowerCase("en-US"));
    }

    logger.info(
      {
        clusters: orderedClusters.map((cluster) => cluster.name),
        participants: orderedParticipants
      },
      "speaker mapping: matched remaining clusters to participants by elimination (no caption evidence)"
    );
  }

  // Dominance fallback ranks remaining participants by how often their name
  // appears in captions. If captions are biased that ranking is meaningless
  // (whoever is mislabelled wins everything), so skip it.
  if (env.ALLOW_LOW_CONFIDENCE_DOMINANCE_MAPPING && !captionsBiased) {
    applyDominanceFallback(transcript, clusters, decisions, usedParticipants, realParticipants, filteredCaptions);
  }

  // Phase D — over-diarization coverage.
  //
  // When the diariser produced MORE clusters than there are known participants,
  // some clusters inevitably survive the evidence phases unmapped — especially
  // when caption labels were ruled unreliable (Gujarati / code-switched Meet
  // captions trip the bias guard, which skips Phases A/B, and Phase C only binds
  // a strict 1==1 or N==N leftover). Rather than expose raw "Speaker A/B/C" when
  // we KNOW exactly who was in the room, give each leftover cluster a real
  // participant: its best per-cluster caption hint when captions are trustworthy,
  // otherwise conversational turn order (cluster first-appearance cycled over
  // join-ordered participants — the natural model for an over-segmented back-and-
  // forth). Best-effort and low-confidence; a participant may legitimately own
  // several clusters. Gated on clusters > participants so it never overrides the
  // evidence-driven mapping or fires when cluster/participant counts already line
  // up (those paths are unchanged).
  const leftoverClusters = orderClustersByFirstAppearance(
    transcript,
    clusters.filter((cluster) => !decisions.has(cluster.name))
  );
  if (uniqueParticipants.length >= 2 && leftoverClusters.length > 0 && clusters.length > uniqueParticipants.length) {
    const joinOrdered = orderParticipantsByJoinTime(uniqueParticipants, participantsTimeline);
    let cycle = 0;
    for (const cluster of leftoverClusters) {
      const hints = !captionsBiased ? captionScores.get(cluster.name) : undefined;
      let participant: string | undefined;
      if (hints && hints.size > 0) {
        const top = [...hints.entries()].sort((a, b) => b[1] - a[1])[0];
        participant = participantsByKey.get(top[0].toLocaleLowerCase("en-US")) ?? top[0];
      }
      let reason = "over-diarization coverage — best per-cluster caption hint";
      if (!participant) {
        participant = joinOrdered[cycle % joinOrdered.length];
        cycle += 1;
        reason = "over-diarization coverage — conversational turn order";
      }
      decisions.set(cluster.name, { cluster: cluster.name, mappedSpeaker: participant, confidence: 0.4, reason });
    }
    logger.info(
      { leftover: leftoverClusters.map((c) => c.name), participants: joinOrdered, captionsBiased },
      "speaker mapping: over-diarization coverage assigned leftover clusters to known participants"
    );
  }

  const decisionLog = [...decisions.values()];
  logger.info({ decisions: decisionLog }, "speaker mapping decisions");

  const clusterLabelByCluster = new Map<string, string>();
  const orderedClustersByAppearance = orderClustersByFirstAppearance(transcript, clusters);
  let unmappedClusterIndex = 0;

  return transcript.map((segment) => {
    const decision = decisions.get(segment.speaker);
    let speaker = decision?.mappedSpeaker ?? segment.speaker;
    let confidence = decision?.confidence;

    // Guard rail: any speaker label that is not a real meeting participant becomes
    // a deterministic Speaker A/B/C tied to the cluster. This handles provider
    // placeholders ("None", numeric ids, "Speaker N"), unsupported clusters, and
    // anything else that survived without caption evidence.
    const speakerKey = speaker.toLocaleLowerCase("en-US");
    if (!participantSet.has(speakerKey)) {
      const clusterKey = segment.clusterId ?? segment.speaker;
      let label = clusterLabelByCluster.get(clusterKey);
      if (!label) {
        // Assign A/B/C based on the cluster's order of first appearance so labels
        // are stable across segments and across runs of the mapper.
        const appearanceIndex = orderedClustersByAppearance.findIndex(
          (cluster) => (cluster.clusterId ?? cluster.name) === clusterKey
        );
        const index = appearanceIndex >= 0 ? appearanceIndex : unmappedClusterIndex;
        label = stableSpeakerLabel(index);
        clusterLabelByCluster.set(clusterKey, label);
        unmappedClusterIndex += 1;
      }
      speaker = label;
      confidence = 0.3;
    }

    if (!decision && speaker === segment.speaker) return segment;
    return {
      ...segment,
      speaker,
      confidence:
        typeof segment.confidence === "number" && typeof confidence === "number"
          ? Math.min(segment.confidence, confidence)
          : segment.confidence ?? confidence ?? 0.3
    };
  });
}

function applyDominanceFallback(
  transcript: DiarizedTranscriptSegment[],
  clusters: Array<{ name: string; duration: number }>,
  decisions: Map<string, MappingDecision>,
  usedParticipants: Set<string>,
  realParticipants: string[],
  captions: CaptionTimelineEntry[]
): void {
  const remainingParticipants = realParticipants.filter(
    (name) => !usedParticipants.has(name.toLocaleLowerCase("en-US"))
  );
  const remainingClusters = orderClustersByFirstAppearance(
    transcript,
    clusters.filter((cluster) => !decisions.has(cluster.name))
  );
  const participantOrder = orderParticipantsByCaptionDominance(remainingParticipants, captions);

  remainingClusters.forEach((cluster, index) => {
    const candidate = participantOrder[index];
    if (!candidate) return;
    const confidence = remainingClusters.length === participantOrder.length ? 0.65 : 0.55;

    decisions.set(cluster.name, {
      cluster: cluster.name,
      mappedSpeaker: candidate,
      confidence,
      reason: "low-confidence dominance order (opt-in)"
    });
    usedParticipants.add(candidate.toLocaleLowerCase("en-US"));
  });
}

function orderClustersByFirstAppearance<T extends { name: string; clusterId?: string }>(
  transcript: DiarizedTranscriptSegment[],
  clusters: T[]
): Array<T & { clusterId?: string }> {
  const firstSeen = new Map<string, number>();
  for (const segment of transcript) {
    const key = segment.clusterId ?? segment.speaker;
    if (!firstSeen.has(key)) firstSeen.set(key, segment.startTime);
    if (!firstSeen.has(segment.speaker)) firstSeen.set(segment.speaker, segment.startTime);
  }
  return [...clusters].sort(
    (a, b) =>
      (firstSeen.get(a.clusterId ?? a.name) ?? firstSeen.get(a.name) ?? Number.POSITIVE_INFINITY) -
      (firstSeen.get(b.clusterId ?? b.name) ?? firstSeen.get(b.name) ?? Number.POSITIVE_INFINITY)
  );
}

function calculateClusterDurations(transcript: DiarizedTranscriptSegment[]): Array<{ name: string; duration: number; clusterId?: string }> {
  const durations = new Map<string, { duration: number; clusterId?: string }>();

  for (const segment of transcript) {
    const existing = durations.get(segment.speaker) ?? { duration: 0, clusterId: segment.clusterId };
    existing.duration += Math.max(0, segment.endTime - segment.startTime);
    if (!existing.clusterId && segment.clusterId) existing.clusterId = segment.clusterId;
    durations.set(segment.speaker, existing);
  }

  return [...durations.entries()]
    .map(([name, { duration, clusterId }]) => ({ name, duration, clusterId }))
    .sort((a, b) => b.duration - a.duration || a.name.localeCompare(b.name));
}

function scoreCaptionHints(
  transcript: DiarizedTranscriptSegment[],
  captions: CaptionTimelineEntry[],
  participantSet: Set<string>,
  meetingStartedAt?: Date
): Map<string, Map<string, number>> {
  const scores = new Map<string, Map<string, number>>();
  const referenceTime = meetingStartedAt?.getTime() ?? captions[0]?.time.getTime();
  if (!referenceTime) return scores;

  for (const segment of transcript) {
    const nearbyCaptions = captions.filter((caption) => {
      const captionOffsetSeconds = (caption.time.getTime() - referenceTime) / 1000;
      return captionOffsetSeconds >= segment.startTime - 2.5 && captionOffsetSeconds <= segment.endTime + 6;
    });

    const bestHint = nearbyCaptions
      .map((caption) => {
        const speaker = cleanParticipantName(caption.speaker);
        if (!speaker || !participantSet.has(speaker.toLocaleLowerCase("en-US"))) return undefined;
        return { speaker, weight: captionTimingWeight(caption, segment, referenceTime) };
      })
      .filter((hint): hint is { speaker: string; weight: number } => Boolean(hint))
      .sort((a, b) => b.weight - a.weight)[0];

    if (bestHint) {
      const clusterScores = scores.get(segment.speaker) ?? new Map<string, number>();
      clusterScores.set(bestHint.speaker, (clusterScores.get(bestHint.speaker) ?? 0) + bestHint.weight);
      scores.set(segment.speaker, clusterScores);
    }
  }

  return scores;
}

function captionTimingWeight(caption: CaptionTimelineEntry, segment: DiarizedTranscriptSegment, referenceTime: number): number {
  const captionOffsetSeconds = (caption.time.getTime() - referenceTime) / 1000;
  if (captionOffsetSeconds >= segment.startTime && captionOffsetSeconds <= segment.endTime + 2) return 1;

  const distance = Math.min(
    Math.abs(captionOffsetSeconds - segment.startTime),
    Math.abs(captionOffsetSeconds - segment.endTime)
  );
  if (distance <= 3) return 0.8;
  return 0.5;
}

function orderParticipantsByCaptionDominance(participants: string[], captions: CaptionTimelineEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const participant of participants) counts.set(participant, 0);

  for (const caption of captions) {
    const speaker = cleanParticipantName(caption.speaker);
    if (!speaker) continue;
    const matching = participants.find((participant) => participant.toLocaleLowerCase("en-US") === speaker.toLocaleLowerCase("en-US"));
    if (matching) counts.set(matching, (counts.get(matching) ?? 0) + 1);
  }

  return [...participants].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b));
}

function filterRosterArtifactCaptions(captions: CaptionTimelineEntry[], participants: string[]): CaptionTimelineEntry[] {
  if (participants.length === 0) return captions;

  const tokens = new Set<string>();
  for (const participant of participants) {
    tokens.add(participant.toLocaleLowerCase("en-US"));
    for (const piece of participant.split(/\s+/).filter(Boolean)) {
      tokens.add(piece.toLocaleLowerCase("en-US"));
    }
  }

  return captions.filter((caption) => {
    const text = caption.text?.replace(/\s+/g, " ").trim();
    if (!text) return false;

    const normalized = text.toLocaleLowerCase("en-US");
    if (tokens.has(normalized)) return false;

    const words = normalized.split(/\s+/);
    if (words.length <= 3 && words.every((word) => tokens.has(word))) return false;

    return true;
  });
}

function stableSpeakerLabel(index: number): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return `Speaker ${alphabet[index] ?? index + 1}`;
}

// Detect the "all captions point at the same person" case. Triggered when:
//   • at least two distinct clusters in the caption scoring map, AND
//   • every cluster's top-scoring caption candidate is the same participant, AND
//   • the meeting actually has more than one real participant.
// This is the signature of a Google Meet rolling caption that re-uses one
// speaker label across interleaved turns, or a Teams caption stream that
// briefly mis-tagged the active speaker for the whole call.
function detectCaptionBias(
  captionScores: Map<string, Map<string, number>>,
  realParticipants: string[]
): boolean {
  if (realParticipants.length < 2) return false;

  const clustersWithHints: Array<{ cluster: string; topParticipantKey: string }> = [];
  for (const [clusterName, scoresMap] of captionScores.entries()) {
    if (scoresMap.size === 0) continue;
    const top = [...scoresMap.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) continue;
    clustersWithHints.push({
      cluster: clusterName,
      topParticipantKey: top[0].toLocaleLowerCase("en-US")
    });
  }
  if (clustersWithHints.length < 2) return false;

  const distinctTops = new Set(clustersWithHints.map((entry) => entry.topParticipantKey));
  return distinctTops.size === 1;
}

// Order participants by their first-seen / join time so the N==N elimination
// pass pairs them with clusters in the same chronological order. Falls back
// to the input order if no timeline entry is available for a participant.
function orderParticipantsByJoinTime(
  participants: string[],
  timeline: ParticipantTimelineEntry[]
): string[] {
  if (timeline.length === 0) return [...participants];

  const earliestByKey = new Map<string, number>();
  for (const entry of timeline) {
    const cleaned = cleanParticipantName(entry.name);
    if (!cleaned) continue;
    const key = cleaned.toLocaleLowerCase("en-US");
    const candidate = (entry.firstSeen ?? entry.joinTime)?.getTime();
    if (typeof candidate !== "number") continue;
    const existing = earliestByKey.get(key);
    if (existing === undefined || candidate < existing) earliestByKey.set(key, candidate);
  }

  return [...participants].sort((a, b) => {
    const aTime = earliestByKey.get(a.toLocaleLowerCase("en-US")) ?? Number.POSITIVE_INFINITY;
    const bTime = earliestByKey.get(b.toLocaleLowerCase("en-US")) ?? Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.localeCompare(b);
  });
}
