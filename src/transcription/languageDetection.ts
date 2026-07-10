// STEP 4 — language detection.
//
// Whisper's own `language` label is unreliable on this team's code-mixed Indic
// audio (it has tagged Gujarati meetings "english"/"punjabi"), so we classify
// from the actual SCRIPT content of the transcript and only fall back to the
// Whisper label when there is no text to analyse. The result drives two things:
//   - meetingLanguage metadata (en | hi | gu | mixed), and
//   - whether to reroute Indic audio to the fallback provider (Sarvam), since
//     Azure Whisper cannot transcribe Gujarati.

const DEVANAGARI = /[ऀ-ॿ]/u; // Hindi / Marathi
const GUJARATI = /[઀-૿]/u;
const LATIN = /[A-Za-z]/u;

export type MeetingLanguage = "en" | "hi" | "gu" | "mixed" | string;

export interface ScriptCounts {
  latin: number;
  devanagari: number;
  gujarati: number;
  total: number;
}

export interface LanguageDetection {
  // One of en | hi | gu | mixed (or a passthrough Whisper code when no script
  // content is available to analyse).
  meetingLanguage: MeetingLanguage;
  // The dominant language code, used as a translation source hint.
  primaryLanguage: string;
  // Distinct languages detected with a meaningful share of the transcript.
  languages: string[];
  // Fraction (0..1) of letters that are Indic script (Devanagari + Gujarati).
  indicFraction: number;
  // Fraction (0..1) of letters that are Latin (English / romanized).
  englishFraction: number;
  // True when the transcript is purely (or overwhelmingly) English — used to
  // skip the translation layer entirely.
  isEnglish: boolean;
  counts: ScriptCounts;
}

// A script must hold at least this share of letters to count as "present" when
// deciding mixed-language. Keeps a stray English acronym from flipping a clean
// Gujarati meeting to "mixed".
const PRESENCE_THRESHOLD = 0.15;

export function countScripts(text: string): ScriptCounts {
  let latin = 0;
  let devanagari = 0;
  let gujarati = 0;
  for (const char of text) {
    if (LATIN.test(char)) latin += 1;
    else if (GUJARATI.test(char)) gujarati += 1;
    else if (DEVANAGARI.test(char)) devanagari += 1;
  }
  return { latin, devanagari, gujarati, total: latin + devanagari + gujarati };
}

/** Fraction of letters that are Indic script. 0 when there are no letters. */
export function indicScriptFraction(text: string): number {
  const counts = countScripts(text);
  if (counts.total === 0) return 0;
  return (counts.devanagari + counts.gujarati) / counts.total;
}

export function detectMeetingLanguage(text: string, whisperLanguage?: string): LanguageDetection {
  const counts = countScripts(text);

  if (counts.total === 0) {
    // No analysable letters — trust the Whisper label (or assume English).
    const fallback = (whisperLanguage || "en").toLocaleLowerCase("en-US");
    return {
      meetingLanguage: fallback,
      primaryLanguage: fallback,
      languages: [fallback],
      indicFraction: 0,
      englishFraction: fallback.startsWith("en") ? 1 : 0,
      isEnglish: fallback.startsWith("en"),
      counts
    };
  }

  const latinFraction = counts.latin / counts.total;
  const devanagariFraction = counts.devanagari / counts.total;
  const gujaratiFraction = counts.gujarati / counts.total;
  const indicFraction = devanagariFraction + gujaratiFraction;

  const present: Array<{ language: string; fraction: number }> = [];
  if (latinFraction >= PRESENCE_THRESHOLD) present.push({ language: "en", fraction: latinFraction });
  if (gujaratiFraction >= PRESENCE_THRESHOLD) present.push({ language: "gu", fraction: gujaratiFraction });
  if (devanagariFraction >= PRESENCE_THRESHOLD) present.push({ language: "hi", fraction: devanagariFraction });
  present.sort((a, b) => b.fraction - a.fraction);

  const ranked = [
    { language: "en", fraction: latinFraction },
    { language: "gu", fraction: gujaratiFraction },
    { language: "hi", fraction: devanagariFraction }
  ].sort((a, b) => b.fraction - a.fraction);
  const primaryLanguage = ranked[0].language;

  const languages = (present.length > 0 ? present : ranked.slice(0, 1)).map((entry) => entry.language);
  const meetingLanguage: MeetingLanguage = languages.length > 1 ? "mixed" : languages[0];
  // Pure-English only when Indic content is negligible.
  const isEnglish = indicFraction < 0.1;

  return {
    meetingLanguage,
    primaryLanguage,
    languages,
    indicFraction,
    englishFraction: latinFraction,
    isEnglish,
    counts
  };
}
