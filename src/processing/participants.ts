import type { CaptionTimelineEntry, Participant, ParticipantSource, ParticipantTimelineEntry } from "../types/meeting";
import { isSpeechCaption } from "./captions";

const stopwordParticipants = new Set([
  "a",
  "an",
  "and",
  "ask",
  "audio",
  "bot",
  "call",
  "camera",
  "caption",
  "captions",
  "chat",
  "close",
  "connecting",
  "device",
  "dial",
  "end",
  "everyone",
  "frame",
  "guest",
  "host",
  "gvoice",
  "keep",
  "join",
  "joined",
  "joining",
  "leave",
  "left",
  "me",
  "ai",
  "meeting",
  "meet",
  "microphone",
  "microsoft",
  "more",
  "mute",
  "muted",
  "name",
  "new",
  "no",
  "none",
  "null",
  "undefined",
  "participant",
  "participants",
  "people",
  "present",
  "presenting",
  "screen",
  "share",
  "someone",
  "speaker",
  "teams",
  "the",
  "transcript",
  "unknown",
  "unmute",
  "video",
  "videocam",
  "waiting",
  "you",
  "zoom",
  // UI control vocabulary that leaks out of loose participant-panel
  // scrapes. Two-user / multi-device meetings expose more of the toolbar
  // because the panel scroll position shifts, so the bot was picking up
  // single-word button labels like "Computer audio" → "Computer". None of
  // these can ever be real participant names.
  "annotate",
  "annotations",
  "applications",
  "apps",
  "arrange",
  "background",
  "blur",
  "breakout",
  "channel",
  "channels",
  "compact",
  "computer",
  "control",
  "controls",
  "copy",
  "default",
  "earpiece",
  "earphone",
  "effects",
  "exit",
  "feedback",
  "filter",
  "filters",
  "find",
  "fullscreen",
  "gallery",
  "headphone",
  "headphones",
  "hide",
  "interpret",
  "interpretation",
  "invite",
  "invites",
  "layout",
  "lighting",
  "live",
  "lobby",
  "lock",
  "lower",
  "raise",
  "applause",
  "clap",
  "fire",
  "heart",
  "thumbs",
  "wave",
  "yes",
  "maximize",
  "menu",
  "menus",
  "minimize",
  "noise",
  "notification",
  "notifications",
  "open",
  "options",
  "output",
  "panel",
  "pause",
  "phone",
  "pin",
  "poll",
  "polls",
  "preferences",
  "presets",
  "react",
  "reaction",
  "reactions",
  "rec",
  "record",
  "recording",
  "rejoin",
  "remote",
  "report",
  "search",
  "send",
  "settings",
  "show",
  "sidebar",
  "sort",
  "spotlight",
  "start",
  "stop",
  "stream",
  "subtitle",
  "subtitles",
  "suppress",
  "suppression",
  "switch",
  "tab",
  "tabs",
  "test",
  "tile",
  "tiles",
  "transcribe",
  "translate",
  "translation",
  "tune",
  "tuning",
  "unpin",
  "view",
  "volume",
  "whiteboard",
  // Language picker options. "English" / "Spanish" / "Hindi" etc. always
  // appear in the caption-language flyout, never as a person's name in a
  // business meeting.
  "arabic",
  "bengali",
  "chinese",
  "dutch",
  "english",
  "filipino",
  "french",
  "german",
  "gujarati",
  "hebrew",
  "hindi",
  "indonesian",
  "italian",
  "japanese",
  "korean",
  "malay",
  "mandarin",
  "marathi",
  "norwegian",
  "persian",
  "polish",
  "portuguese",
  "punjabi",
  "romanian",
  "russian",
  "spanish",
  "swedish",
  "tagalog",
  "tamil",
  "telugu",
  "thai",
  "turkish",
  "ukrainian",
  "urdu",
  "vietnamese",
  // Common English caption-starter words that should never be treated as a
  // participant name even if they slip out of the panel parser.
  "about",
  "after",
  "again",
  "all",
  "also",
  "am",
  "any",
  "anyway",
  "are",
  "as",
  "at",
  "be",
  "because",
  "before",
  "but",
  "by",
  "bye",
  "can",
  "could",
  "did",
  "do",
  "does",
  "done",
  "during",
  "fine",
  "for",
  "from",
  "get",
  "go",
  "going",
  "good",
  "got",
  "great",
  "had",
  "has",
  "have",
  "he",
  "hello",
  "hey",
  "hi",
  "how",
  "i",
  "if",
  "im",
  "is",
  "it",
  "its",
  "let",
  "lets",
  "like",
  "may",
  "maybe",
  "might",
  "mm",
  "mhm",
  "my",
  "nah",
  "nope",
  "of",
  "off",
  "ok",
  "okay",
  "on",
  "one",
  "or",
  "our",
  "out",
  "over",
  "please",
  "really",
  "right",
  "say",
  "see",
  "she",
  "should",
  "so",
  "some",
  "sorry",
  "still",
  "sure",
  "thank",
  "thanks",
  "that",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "to",
  "too",
  "uh",
  "uhm",
  "um",
  "until",
  "up",
  "very",
  "was",
  "we",
  "well",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "would",
  "yeah",
  "yep",
  "yes",
  "your",
  "yup",
  // Google Meet effects / Gemini / toolbar single-word labels and capitalised
  // caption sentence-fragments that leak out of the participant-panel scrape as
  // Title-case tokens (so they pass the "capitalised ⇒ probably a name"
  // heuristic below). None of these are ever real participant names.
  "adjust",
  "alright",
  "another",
  "backgrounds",
  "delay",
  "delaying",
  "enter",
  "font",
  "fonts",
  "form",
  "gemini",
  "here",
  "huh",
  "in",
  "make",
  "mm-hmm",
  "not",
  "now",
  "perfect",
  "pm",
  "press",
  "question",
  "questions",
  "reframe",
  "take",
  "think",
  "transcribing",
  "turn",
  // Project-specific product / app names that surface in captions but are not
  // people.
  "comforce",
  "comtrac",
  "comtract",
  "mascom",
  "masscom",
  "pmm",
  // Google Meet UI words that the panel/caption scrapers occasionally
  // misattribute as a participant first-name. "Welcome" leaks from Meet's
  // join-toast and from caption text ("Jayesh Jadav Welcome."), "google" from
  // the product wordmark and from captions like "Google meet my channel".
  // "meet" / "meeting" are already above; these add the missing siblings.
  "google",
  "welcome",
  // Participant-STATUS words. Teams/Meet/Zoom render a live status line next to
  // (or in place of) a person's name in the roster — "Leaving", "Reconnecting",
  // "Ringing", etc. These arrive Title-cased and single-token, so they sail past
  // the "capitalised ⇒ probably a name" heuristic and show up as a phantom
  // participant (observed in prod: session 16ac9294 listed a 4th attendee
  // "Leaving"). The base verbs "leave"/"left"/"join"/"joined"/"joining"/
  // "waiting"/"connecting"/"present"/"presenting"/"muted"/"unmuted" are already
  // above; these add the -ing / status siblings that were missing.
  "leaving",
  "rejoining",
  "reconnecting",
  "reconnected",
  "disconnected",
  "disconnecting",
  "removed",
  "admitting",
  "admitted",
  "ringing",
  "calling",
  "called",
  "dialing",
  "dialling",
  "declined",
  "busy",
  "unavailable",
  "away",
  "idle",
  "hold",
  "offline",
  "online",
  "active",
  "inactive",
  "speaking",
  "typing",
  "pinned",
  "spotlighted"
]);

const suffixNoise = /\b(\(.*?\)|\[.*?\]|host|guest|external|organizer|presenter|presenting|muted|unmuted|you|me)\b/giu;
const nonNamePunctuation = /[^\p{L}\p{M}\s.'-]/gu;
const repeatedWhitespace = /\s+/g;

// Multi-word UI label patterns. The single-word stopword list catches the
// reduced first-token; this catches the full string before reduction so
// labels like "Computer audio" (which would collapse to "Computer") and
// "Send a chat message" (which would collapse to "Send a") get rejected
// outright. Patterns are anchored ^...$ and matched against the normalised,
// lowercased string.
const uiLabelPatterns: RegExp[] = [
  /^(computer|phone|device|speaker|earpiece|headphone) (audio|sound|output|input)$/,
  /^(test|switch|join|leave|change|select|stop|start|open|close|set|enable|disable|toggle|share|stop sharing) .+/,
  /^send( a)? (message|chat|reaction|note|emoji|gif)$/,
  /^(turn (on|off)|enable|disable) (captions?|subtitles?|video|camera|microphone|mic|audio|recording|sound|noise|spotlight|gallery)/,
  /^(raise|lower) (hand|your hand)$/,
  /^(record|recording|stop recording|pause recording|resume recording)( cloud| this meeting)?$/,
  /^breakout rooms?$/,
  /^(captions?|subtitles?|reactions?|polls?|whiteboard|annotations?|notifications?|chat( messages?)?|chat input|chat panel)$/,
  /^(microphone|camera|video|audio|speaker|headphone) (on|off|muted|unmuted|enabled|disabled|test|settings?)$/,
  /^(host|co.?host|panelist|guest|presenter|organizer)( controls?)?$/,
  /^(more|view|menu|options?|settings?|preferences?|controls?|layout|gallery|tile|grid|spotlight|sidebar|panel|tab|tabs|filters?)( view| options?| menu)?$/,
  /^(send a reaction|raise hand|invite people|invite others|copy invite|copy link|share screen|stop share|present now|stop presenting|leave call|leave meeting|end (call|meeting)|join audio|join video|start audio|start video|enable audio|enable video)$/,
  /^(search|search bar|search for people|find a meeting|search messages)$/,
  /^(focus mode|together mode|grid view|gallery view|speaker view|side by side|fullscreen|full screen)$/,
  /^(applications?|integrations?|breakouts?|polls?|q&a|q ?and ?a|reactions?|whiteboard|annotations?|files?|chats?|tasks?)$/,
  /^(background (effects?|blur|filters?)|video filters?|appearance filters?|touch up|lighting)$/,
  /^(noise (suppression|cancellation|removal)|echo cancellation|original sound|stereo audio|high fidelity)$/,
  /^(closed captions?|live captions?|live transcript|live transcription|generated captions?|live subtitles?)$/,
  /^(immersive view|side bar|together mode|whiteboard|chat (panel|window|pane))$/,
  /^(open|close|show|hide) (chat|people|participants|reactions|panel|sidebar|menu|controls|captions|subtitles|breakouts?|polls?)$/,
  /^(rec|live|on air|recording in progress|meeting recorded|streaming)$/,
  /^\d+ (participants?|people|attendees?|members?)$/,
  /^add (people|participants|guests|members|others?)$/
];

function looksLikeUiLabel(normalizedLowercased: string): boolean {
  if (!normalizedLowercased) return false;
  return uiLabelPatterns.some((pattern) => pattern.test(normalizedLowercased));
}

// Notetaker / AI-assistant bot signatures. Matched against the RAW panel name
// before any token reduction so we still see signals like "Himanshu's Fathom
// Notetaker (Unverified)" — without this, cleanParticipantName would reduce
// that string to "Himanshu" and silently merge the bot onto the real person,
// which (a) inflates the human count so the auto-leave alone-timer never
// fires when only bots remain, and (b) corrupts speaker attribution.
//
// We intentionally do NOT trigger on "(Unverified)" alone — Teams marks
// legitimate external guests with it too. Triggers are either a generic
// notetaker/transcribing/AI-companion phrase OR a known bot vendor name.
const botParticipantPatterns: RegExp[] = [
  /\bnote ?taker\b/i,
  /\btranscrib(?:e|er|ing|tion)\b/i,
  /\bai (?:companion|notetaker|note ?taker|recorder|assistant|scribe|secretary)\b/i,
  /\b(?:meeting )?(?:recorder bot|recording bot|recorder|recording)\s+bot\b/i,
  // Brand names only — kept narrow so we don't false-positive on humans who
  // share a common word. "Jamie" is intentionally excluded (real first name);
  // bot variants like "Jamie AI" / "Jamie Notetaker" are still caught by the
  // generic notetaker/AI-assistant patterns above.
  /\b(?:otter\.?ai|fathom|fireflies(?:\.ai)?|read\.?ai|avoma|grain(?:\.io)?|tl;?dv|meetgeek|spinach(?:\.io)?|sembly|krisp|circleback|granola|notta|chorus(?:\.ai)?|gong(?:\.io)?|laxis|claap|tactiq|airgram|colibri|fellow(?:\.app)?)\b/i
];

export function isBotParticipantName(rawName: string | null | undefined): boolean {
  if (!rawName) return false;
  // Probe the raw string AND a lightly-normalized version (parens/punct
  // collapsed) so panels that show the vendor name in brackets like
  // "(Otter.ai)" still match cleanly.
  const compact = rawName.replace(/[()\[\]{}]+/g, " ").replace(/\s+/g, " ");
  return botParticipantPatterns.some((pattern) => pattern.test(rawName) || pattern.test(compact));
}

export function cleanParticipantName(rawName: string | null | undefined): string | null {
  if (!rawName) return null;
  // Notetaker bots are filtered BEFORE any token reduction so the bot's
  // owner-prefixed label (e.g. "Himanshu's Fathom Notetaker") doesn't
  // collapse onto the real person's first name downstream.
  if (isBotParticipantName(rawName)) return null;

  const withoutEmails = rawName.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ");
  const normalized = withoutEmails
    .replace(suffixNoise, " ")
    .replace(nonNamePunctuation, " ")
    .replace(repeatedWhitespace, " ")
    .trim();

  if (!normalized) return null;
  if (/\d/.test(normalized)) return null;

  // UI-label rejection runs on the *full* normalised string before we collapse
  // to the first token. Without this, labels like "Computer audio" become
  // "Computer" (which isn't a single-token stopword) and slip through.
  if (looksLikeUiLabel(normalized.toLocaleLowerCase("en-US"))) return null;

  // Suspicious shapes: very long strings or strings with more than 5 tokens are
  // almost certainly button/menu copy, not a person's name.
  const tokenCount = normalized.split(" ").length;
  if (normalized.length > 60 || tokenCount > 5) return null;

  const firstTokenRaw = normalized.split(" ")[0]?.replace(/^[-'.]+|[-'.]+$/g, "");
  if (!firstTokenRaw || firstTokenRaw.length < 2) return null;

  // Drop a trailing possessive/contraction so panel scrapes like "Chetan's"
  // collapse onto "Chetan" (and de-dupe against it), and caption fragments like
  // "That's" reduce to the "that" stopword instead of leaking through.
  const firstToken = firstTokenRaw.replace(/['’`]s$/iu, "") || firstTokenRaw;
  if (firstToken.length < 2) return null;

  const lowercase = firstToken.toLocaleLowerCase("en-US");
  // Compare against stopwords both verbatim and with internal apostrophes
  // stripped (so "I'm" → "im" matches).
  const lowercaseStripped = lowercase.replace(/['’`]/g, "");
  if (stopwordParticipants.has(lowercase) || stopwordParticipants.has(lowercaseStripped)) return null;

  if (!/\p{L}/u.test(firstToken)) return null;

  // Single-word "Title" cases: if the only token is lowercase or all-caps, it
  // is almost certainly a UI label that escaped the stopword set. A real first
  // name from the participant panel always arrives capitalised.
  if (tokenCount === 1) {
    const original = firstToken;
    if (original === original.toLocaleLowerCase("en-US")) return null;
    if (original === original.toLocaleUpperCase("en-US") && original.length > 3) return null;
  }

  return firstToken.charAt(0).toLocaleUpperCase("en-US") + firstToken.slice(1);
}

export function isStopwordParticipant(name: string): boolean {
  return stopwordParticipants.has(name.toLocaleLowerCase("en-US"));
}

export class ParticipantTracker {
  private readonly entries = new Map<string, { name: string; source: ParticipantSource; firstSeen: Date; lastSeen: Date }>();

  observe(rawNames: string[], source: ParticipantSource, seenAt = new Date()): Participant[] {
    const observed: Participant[] = [];

    for (const rawName of rawNames) {
      const name = cleanParticipantName(rawName);
      if (!name) continue;
      const key = name.toLocaleLowerCase("en-US");
      const existing = this.entries.get(key);

      if (existing) {
        existing.lastSeen = seenAt;
      } else {
        this.entries.set(key, { name, source, firstSeen: seenAt, lastSeen: seenAt });
      }

      observed.push({ name, source });
    }

    return dedupeParticipants(observed);
  }

  getParticipants(): Participant[] {
    return dedupeParticipants(
      [...this.entries.values()]
        .sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime())
        .map((entry) => ({ name: entry.name, source: entry.source }))
    );
  }

  getTimeline(meetingEndedAt = new Date()): ParticipantTimelineEntry[] {
    return [...this.entries.values()]
      .sort((a, b) => a.firstSeen.getTime() - b.firstSeen.getTime())
      .map((entry) => ({
        name: entry.name,
        joinTime: entry.firstSeen,
        leaveTime: null,
        firstSeen: entry.firstSeen,
        lastSeen: entry.lastSeen
      }));
  }
}

export function dedupeParticipants(participants: Participant[]): Participant[] {
  const deduped = new Map<string, Participant>();
  for (const participant of participants) {
    const name = cleanParticipantName(participant.name);
    if (!name) continue;
    const key = name.toLocaleLowerCase("en-US");
    if (!deduped.has(key)) deduped.set(key, { name, source: participant.source });
  }
  return [...deduped.values()];
}

export function validatedCaptionSpeakers(captions: CaptionTimelineEntry[]): Participant[] {
  const speakerStats = new Map<string, { name: string; count: number; words: number }>();

  for (const caption of captions) {
    if (!isSpeechCaption(caption)) continue;
    const name = cleanParticipantName(caption.speaker);
    if (!name) continue;
    const key = name.toLocaleLowerCase("en-US");
    const existing = speakerStats.get(key) ?? { name, count: 0, words: 0 };
    existing.count += 1;
    existing.words += caption.text.split(/\s+/).filter(Boolean).length;
    speakerStats.set(key, existing);
  }

  const speakers = [...speakerStats.values()]
    .filter((stats) => stats.count >= 2 || stats.words >= 6)
    .map((stats) => stats.name);

  return dedupeParticipants(speakers.map((name) => ({ name, source: "caption_label" })));
}

export function mergeParticipants(primary: Participant[], secondary: Participant[]): Participant[] {
  return dedupeParticipants([...primary, ...secondary]);
}

export function buildCaptionSpeakerTimeline(captions: CaptionTimelineEntry[]): ParticipantTimelineEntry[] {
  const validSpeakers = new Set(validatedCaptionSpeakers(captions).map((participant) => participant.name.toLocaleLowerCase("en-US")));
  const entries = new Map<string, { name: string; firstSeen: Date; lastSeen: Date }>();

  for (const caption of captions) {
    if (!isSpeechCaption(caption)) continue;
    const name = cleanParticipantName(caption.speaker);
    if (!name || !validSpeakers.has(name.toLocaleLowerCase("en-US"))) continue;
    const key = name.toLocaleLowerCase("en-US");
    const existing = entries.get(key);
    if (existing) {
      existing.lastSeen = caption.time;
    } else {
      entries.set(key, { name, firstSeen: caption.time, lastSeen: caption.time });
    }
  }

  return [...entries.values()].map((entry) => ({
    name: entry.name,
    joinTime: entry.firstSeen,
    leaveTime: null,
    firstSeen: entry.firstSeen,
    lastSeen: entry.lastSeen
  }));
}

export function mergeParticipantTimelines(primary: ParticipantTimelineEntry[], secondary: ParticipantTimelineEntry[]): ParticipantTimelineEntry[] {
  const merged = new Map<string, ParticipantTimelineEntry>();

  for (const entry of [...primary, ...secondary]) {
    const name = cleanParticipantName(entry.name);
    if (!name) continue;
    const key = name.toLocaleLowerCase("en-US");
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, { ...entry, name, leaveTime: null });
      continue;
    }

    const firstSeen = earlierDate(existing.firstSeen ?? existing.joinTime, entry.firstSeen ?? entry.joinTime);
    const lastSeen = laterDate(existing.lastSeen ?? existing.joinTime, entry.lastSeen ?? entry.joinTime);
    merged.set(key, {
      ...existing,
      joinTime: firstSeen,
      firstSeen,
      lastSeen,
      leaveTime: null
    });
  }

  return [...merged.values()].sort((a, b) => a.joinTime.getTime() - b.joinTime.getTime());
}

function earlierDate(left: Date, right: Date): Date {
  return left.getTime() <= right.getTime() ? left : right;
}

function laterDate(left: Date, right: Date): Date {
  return left.getTime() >= right.getTime() ? left : right;
}
