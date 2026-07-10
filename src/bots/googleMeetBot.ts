import { env } from "../config/env";
import { cfgNumber } from "../config/runtimeConfig";
import type { CaptionTimelineEntry } from "../types/meeting";
import { delay } from "../utils/async";
import { BaseMeetingBot } from "./baseMeetingBot";
import type { Logger } from "pino";

export class GoogleMeetBot extends BaseMeetingBot {
  // Consecutive failed attempts to (re)open the people panel before we stop
  // clicking and fall back to lighter scrapes. Per-streak budget, reset on every
  // successful panel read — Google's side panel collapses mid-call (and
  // sometimes fails to open at all for the first ~minute after admission), so a
  // one-shot open is not enough: muted participants who never speak only show
  // up in the panel, and missing them collapses post-hoc speaker mapping onto
  // too few names (3 diarization clusters → 2 participants → wrong attribution).
  private static readonly MAX_PANEL_OPEN_ATTEMPTS = 12;
  private panelBelievedOpen = false;
  private panelOpenAttempts = 0;
  private lastPanelNames: string[] = [];
  private captionsEnableAttempted = false;
  private captionsEnableSucceeded = false;
  // Budget for capture-loop retries when join-time caption enable failed.
  // Each retry consumes 1; at 2s capture interval the loop runs ~30/min, so
  // 8 budget covers roughly the first 4 minutes of the meeting. After that we
  // accept Speaker A/B labels rather than poll forever.
  private captionsRetryBudget = 8;
  // Cached bot self-name from data-self-name (Google's selfTile attribute).
  // undefined = not yet read; null = read but absent. Used to exclude the
  // bot's own tile/label from participant + caption scraping so the bot
  // doesn't conflate with a same-named real participant.
  private selfName: string | undefined | null = undefined;

  constructor(logger: Logger) {
    super(env.GOOGLE_USER_DATA_DIR, logger);
  }

  private async getBotSelfName(): Promise<string | undefined> {
    if (this.selfName !== undefined) return this.selfName ?? undefined;
    const value = await this.getPage()
      .evaluate(() => {
        const node = document.querySelector("[data-self-name]");
        const raw = node?.getAttribute("data-self-name") ?? "";
        return raw.replace(/\s+/g, " ").trim() || null;
      })
      .catch(() => null);
    this.selfName = value;
    if (value) this.logger.info({ selfName: value }, "google bot self-name resolved from data-self-name");
    return value ?? undefined;
  }

  protected override getRecordingHideSelectors(): string[] {
    return [
      // Right-side people / chat panels — opening these moves the meeting
      // viewport but adds nothing to the recording, so hide them.
      'div[aria-label*="people" i][role="dialog"]',
      'div[aria-label*="people panel" i]',
      'div[aria-label*="participants" i][role="dialog"]',
      'div[aria-label*="chat" i][role="dialog"]',
      // Mic/camera "not found" warning toast that Google Meet shows because
      // the bot denies getUserMedia. Hidden from the recording; the bot
      // dismisses the X separately in dismissOverlays.
      'div[role="alertdialog"][aria-label*="microphone" i]',
      'div[role="alertdialog"][aria-label*="camera" i]',
      'div[role="alert"][aria-label*="microphone" i]',
      'div[role="alert"][aria-label*="camera" i]'
      // NOTE: caption overlay selectors are intentionally not listed here. We
      // need captions visible in the DOM so snapshotCaptions can read them via
      // innerText. The bot's in-page visibility filter rejects opacity:0
      // elements, so hiding captions through this CSS would also blind the
      // scraper and produce an empty captionsTimeline. Captions will appear
      // in the recorded MP4 — that's an accepted trade-off because they give
      // viewers a visual reference and they feed the speaker mapper.
    ];
  }

  // Buttons that move us from the pre-join screen into the call (or the lobby).
  private static readonly JOIN_BUTTON_PATTERNS = [/ask to join/i, /join now/i, /^join$/i];

  async join(meetingUrl: string): Promise<Date> {
    await this.gotoMeeting(meetingUrl);
    await this.turnMicAndCameraOff();
    // When the bot's Google session has lapsed, Meet shows the anonymous
    // pre-join screen ("What's your name?") and keeps the join button disabled
    // until a name is entered. Fill it so the bot can knock as a guest
    // regardless of sign-in state (the host admits from the lobby — no calendar
    // invite required, same as other notetaker bots).
    await this.fillDisplayName();
    await this.clickJoinButton(GoogleMeetBot.JOIN_BUTTON_PATTERNS);

    // The bot is dispatched ~90s BEFORE the scheduled start (calendar lead
    // time), so the room is frequently not live yet: Google shows "You can't
    // join this video call" and, after a 60s countdown, bounces the tab to the
    // marketing site. The old code polled that dead page until the join
    // timeout and gave up. Instead, keep re-navigating to the meeting URL until
    // the room opens, then knock and wait in the lobby for the host to admit
    // (no calendar invite required — same flow as other notetaker bots).
    const joinedAt = await this.waitUntilAdmittedWithRetry(meetingUrl);

    await this.prepareMeetingView();
    await this.waitForGoogleInMeetingControls();
    await delay(800);
    await this.enableCaptions();
    return joinedAt;
  }

  // States that mean "not in the call yet". `lobby` = knock submitted, host
  // hasn't admitted (DON'T re-navigate — that cancels the knock). `blocked` =
  // room not live yet or the tab got bounced off the meeting (DO re-navigate).
  private static readonly LOBBY_TEXT =
    /asking to be let in|waiting for the host|someone will let you in|you'?ll join the call when|wait(ing)? for someone to let you in|let you in soon/i;
  private static readonly BLOCKED_TEXT =
    /you can'?t join this video call|return to home screen|check your meeting code|no one can join/i;

  private async waitUntilAdmittedWithRetry(meetingUrl: string): Promise<Date> {
    const page = this.getPage();
    const meetingCode = /meet\.google\.com\/[a-z]{3}-[a-z]{4}-[a-z]{3}/i;
    const deadline = Date.now() + (cfgNumber("JOIN_TIMEOUT_MS") ?? env.JOIN_TIMEOUT_MS);
    let lastLogAt = 0;
    let lastRenavAt = 0;

    while (true) {
      if (Date.now() > deadline) {
        throw new Error(
          "google meet join timed out — room never became joinable or the bot was not admitted"
        );
      }

      // Inside the call?
      for (const pattern of [/leave call/i, /leave meeting/i]) {
        if (await this.isRoleButtonVisibleAcrossFrames(pattern, 250)) {
          const joinedAt = new Date();
          this.logger.info({ joinedAt }, "confirmed inside meeting");
          return joinedAt;
        }
      }

      const text = (await this.readBodyTextAcrossFrames()).replace(/\s+/g, " ").trim();
      if (/you'?re the only one here|you are the only one here/i.test(text)) {
        const joinedAt = new Date();
        this.logger.info({ joinedAt }, "confirmed inside meeting (only participant)");
        return joinedAt;
      }

      const url = page.url();
      const inLobby = GoogleMeetBot.LOBBY_TEXT.test(text);
      const blocked = GoogleMeetBot.BLOCKED_TEXT.test(text) || !meetingCode.test(url);

      if (Date.now() - lastLogAt > 10000) {
        lastLogAt = Date.now();
        this.logger.info(
          { url, inLobby, blocked, visibleText: text.slice(0, 200) },
          "google meet join waiting (retry-aware)"
        );
      }

      // Knock submitted — sit tight and let the host admit. Re-navigating here
      // would drop us out of the lobby.
      if (inLobby) {
        await delay(1000);
        continue;
      }

      // Not live yet / bounced off the meeting — re-navigate and re-knock,
      // throttled so we don't reload faster than the page can settle.
      if (blocked) {
        // Re-navigate at most every 20s. Reloading faster (the room is often
        // not live yet because we join ~90s early) trips Google's anti-abuse
        // gate, which then serves "You can't join this video call" even after
        // the host arrives. Between re-navigations we just keep polling.
        if (Date.now() - lastRenavAt > 20000) {
          lastRenavAt = Date.now();
          this.logger.info({ url, meetingUrl }, "google meet not joinable yet — re-navigating to retry");
          await this.gotoMeeting(meetingUrl).catch(() => undefined);
          await this.turnMicAndCameraOff().catch(() => undefined);
          await this.fillDisplayName().catch(() => undefined);
          await this.clickJoinButton(GoogleMeetBot.JOIN_BUTTON_PATTERNS).catch(() => undefined);
        }
        await delay(3000);
        continue;
      }

      // On the pre-join screen but not yet knocking — the join button may have
      // only just rendered, or it's still disabled because the guest-name field
      // is empty (lapsed session → anonymous screen). Fill the name and click.
      await this.fillDisplayName().catch(() => undefined);
      await this.clickJoinButton(GoogleMeetBot.JOIN_BUTTON_PATTERNS).catch(() => undefined);
      await delay(700);
    }
  }

  async snapshotParticipants(): Promise<string[]> {
    const selfName = await this.getBotSelfName();
    let snapshot = await this.readGooglePeoplePanel(selfName);

    if (snapshot.open && snapshot.names.length > 0) {
      this.panelBelievedOpen = true;
      this.panelOpenAttempts = 0;
      this.lastPanelNames = snapshot.names;
      this.logger.info({ names: snapshot.names, strategy: "panel_read" }, "google participants from open panel");
      return [...new Set(snapshot.names)];
    }

    // Re-open whenever the panel isn't currently readable — not just on the
    // very first attempt. Google collapses the panel mid-call, and the first
    // open click after admission sometimes no-ops (people-button isn't wired
    // yet, or overlay blocks it). Bounded by MAX_PANEL_OPEN_ATTEMPTS and reset
    // on every successful read above, so we keep trying while panel is closed
    // but don't hammer indefinitely if Google reshuffles selectors.
    if (!snapshot.open && this.panelOpenAttempts < GoogleMeetBot.MAX_PANEL_OPEN_ATTEMPTS) {
      this.panelOpenAttempts += 1;
      const clickResult = await this.clickGooglePeopleButtonToOpen();
      this.logger.info(
        { clickResult, panelOpen: snapshot.open, attempt: this.panelOpenAttempts, debug: snapshot.debug },
        "google people button open/read attempt"
      );
      await delay(1500);
      snapshot = await this.readGooglePeoplePanel(selfName);
      if (snapshot.open && snapshot.names.length > 0) {
        this.panelBelievedOpen = true;
        this.panelOpenAttempts = 0;
        this.lastPanelNames = snapshot.names;
        this.logger.info({ names: snapshot.names, strategy: "panel_after_open" }, "google participants from panel after open");
        return [...new Set(snapshot.names)];
      }
    }

    const tileNames = await this.readGoogleMeetVideoTileNames(selfName);
    if (tileNames.length > 0) {
      this.logger.info({ tileNames, strategy: "video_tiles" }, "google participants scraped from video tiles");
      this.lastPanelNames = tileNames;
      return [...new Set(tileNames)];
    }

    const broadNames = await this.readTextsFromSelectors([
      '[role="listitem"]',
      '[data-participant-id]',
      '[data-self-name]',
      '[aria-label*="participant" i]',
      '[aria-label*="people" i] [role="listitem"]'
    ]);
    if (broadNames.length > 0) {
      this.logger.info({ broadNames, strategy: "broad_selectors" }, "google participants from broad selectors");
      this.lastPanelNames = broadNames;
      return [...new Set(broadNames)];
    }

    const fallback = [...new Set(this.lastPanelNames)];
    this.logger.info(
      { fallbackNames: fallback, panelOpenAttempts: this.panelOpenAttempts },
      "google participant snapshot returning cached/fallback names"
    );
    return fallback;
  }

  // Override to perform Google-specific, robust DOM-based caption parsing
  override async snapshotCaptions(): Promise<Array<Omit<CaptionTimelineEntry, "source">>> {
    // Self-healing: if captions never turned on at join, retry from inside
    // the capture loop. Cheap when already enabled.
    await this.ensureCaptionsEnabled().catch(() => undefined);
    const time = new Date();
    const selfName = await this.getBotSelfName();

    return this.getPage().evaluate(({ currentTimeMs, selfName }) => {
      const timeObj = new Date(currentTimeMs);
      const results: Array<Omit<CaptionTimelineEntry, "source">> = [];
      const controlText =
        /^(turn on captions|turn off captions|captions|closed_caption|send a reaction|raise hand|more options|leave call|microphone|camera|present now|you are presenting|people|chat|meeting details|activities|host controls|oab-mjxz-pcc|\d{1,2}:\d{2}\s*[AP]M?)$/i;
      // Names like "Ruchit Pithva" or "Pratik Rana" — two or three capitalized
      // tokens, no sentence punctuation. Google's aria-live presence
      // announcements echo participant tile labels through the same region the
      // bot reads for captions, so without this filter every silent meeting
      // produces a fake transcript of attendee names.
      const looksLikeNameLabel = (text: string): boolean => {
        const tokens = text.trim().split(/\s+/);
        if (tokens.length < 1 || tokens.length > 3) return false;
        if (/[.!?,;:"]/.test(text)) return false;
        return tokens.every((token) => /^[\p{Lu}][\p{L}\p{M}'.-]{0,30}$/u.test(token));
      };
      const selfNameLower = selfName ? selfName.toLocaleLowerCase("en-US") : "";
      const visible = (element: Element): boolean => {
        const node = element as HTMLElement;
        const rect = node.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        const style = window.getComputedStyle(node);
        return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      };
      const textOf = (element: Element): string => ((element as HTMLElement).innerText || element.textContent || "").replace(/\s+/g, " ").trim();
      // Settings widgets that sit next to the caption overlay leak into the
      // scrape via aria-live. These reject captions where speaker or text
      // matches the caption-settings vocabulary (Material Icon names like
      // "format_size" / "color_lens" never appear in real speech).
      const captionSettingsSpeaker =
        /^(language|english|settings|font|format|caption|captions|subtitle|subtitles|open|close|more)$/i;
      const captionSettingsText =
        /format_size|color_lens|open caption settings|caption settings|caption preferences|subtitle settings|font color settings|font size settings/i;
      const materialIconTokens = /\b(format_size|color_lens|settings|circle|tune|translate)\b/i;

      const pushCaption = (speaker: string, text: string) => {
        const cleanSpeaker = speaker.replace(/\s+/g, " ").trim();
        const cleanText = text.replace(/\s+/g, " ").trim();
        if (!cleanSpeaker || !cleanText || controlText.test(cleanText)) return;

        // Caption-settings widget contamination (the "English / format_size /
        // Font size / Font color / Open caption settings" blob that Google
        // Meet renders alongside the live captions overlay).
        if (captionSettingsSpeaker.test(cleanSpeaker)) return;
        if (captionSettingsText.test(cleanText)) return;
        // Material Icon glyph name leak in early tokens of the text: real
        // speech does not contain "format_size" / "color_lens" / etc.
        const earlyTokens = cleanText.split(/\s+/).slice(0, 6).join(" ");
        if (materialIconTokens.test(earlyTokens)) return;

        const speakerLower = cleanSpeaker.toLocaleLowerCase("en-US");
        const textLower = cleanText.toLocaleLowerCase("en-US");

        // Bot's own tile / "(You) Ruchit Pithva" presence echo — never speech.
        if (selfNameLower) {
          const selfFirst = selfNameLower.split(/\s+/)[0];
          if (textLower === selfNameLower || textLower === selfFirst) return;
          if (speakerLower === selfNameLower || speakerLower === selfFirst) return;
        }
        // Pure echo: text is just the speaker name (e.g. "Ruchit" / "Ruchit").
        if (textLower === speakerLower) return;
        // Tile label / aria-live presence announcement: text is the speaker's
        // first name followed by a last name, with no sentence punctuation.
        // (Real captions starting with a capitalized word — e.g. "Google Meet
        // works" — are kept because the speaker won't match the first token.)
        const textTokens = textLower.split(/\s+/);
        if (textTokens.length <= 3 && textTokens[0] === speakerLower && looksLikeNameLabel(cleanText)) return;

        results.push({ speaker: cleanSpeaker, text: cleanText, time: timeObj });
      };
      const parseLines = (rawText: string, fallbackSpeaker: string) => {
        const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
        if (lines.length >= 2 && lines[0].length <= 60 && !controlText.test(lines[0])) {
          pushCaption(lines[0], lines.slice(1).join(" "));
          return;
        }

        const normalized = rawText.replace(/\s+/g, " ").trim();
        const colon = normalized.match(/^([^:]{2,60}):\s*(.+)$/);
        if (colon) {
          pushCaption(colon[1], colon[2]);
          return;
        }

        if (normalized.length >= 3 && normalized.length <= 500 && !controlText.test(normalized)) {
          pushCaption(fallbackSpeaker, normalized);
        }
      };
      const activeSpeakerName = (() => {
        const candidates = Array.from(document.querySelectorAll("div, span")) as HTMLElement[];
        const activeTiles = candidates
          .filter(visible)
          .map((node) => {
            const rect = node.getBoundingClientRect();
            const style = window.getComputedStyle(node);
            const text = (node.innerText || node.textContent || "").split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(-1)[0] ?? "";
            const highlighted =
              style.outlineColor.includes("251") ||
              style.borderColor.includes("251") ||
              style.boxShadow.includes("rgb(251") ||
              style.boxShadow.includes("255, 213");
            return { rect, text, highlighted };
          })
          .filter(({ rect, text, highlighted }) => highlighted && rect.width > 160 && rect.height > 120 && /^[\p{L}\p{M} .'-]{2,80}$/u.test(text));
        return activeTiles[0]?.text ?? "Unknown Speaker";
      })();

      // PRIMARY: target the specific caption-message containers. These are
      // strictly the rendered caption lines and do not include the captions
      // settings panel (font picker, language selector, etc.) that sits next
      // to the overlay and used to leak into the scrape via aria-live.
      const captionMessageNodes = Array.from(
        document.querySelectorAll('[jsname][data-message-text]')
      ).filter(visible) as HTMLElement[];

      for (const node of captionMessageNodes) {
        const lines = (node.innerText || node.textContent || "")
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        if (lines.length >= 2) {
          pushCaption(lines[0], lines.slice(1).join(" "));
        } else if (lines.length === 1) {
          // Single-line caption node: usually just the caption text — find the
          // nearest ancestor that also has a name (sibling div before the text).
          const speakerSibling = node.parentElement?.querySelector('img')?.closest('div')?.parentElement;
          const speakerLines = ((speakerSibling?.innerText ?? "") || "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
          const speaker = speakerLines.find((l) => l.length <= 60 && !/[.!?,;:]/.test(l)) ?? "Unknown Speaker";
          pushCaption(speaker, lines[0]);
        }
      }

      // SECONDARY: aria-live polite regions — broader catch but also catches
      // the caption settings panel. Only used when the primary scan found
      // nothing, and only for regions whose text does NOT look like settings.
      if (results.length === 0) {
        const liveRegions = Array.from(document.querySelectorAll('[aria-live="polite"]')).filter(visible);
        const looksLikeSettings = (text: string): boolean =>
          /format_size|color_lens|caption settings|caption preferences|font size settings|font color settings|open caption settings/i.test(text);

        for (const region of liveRegions) {
          const regionText = (region as HTMLElement).innerText || region.textContent || "";
          if (looksLikeSettings(regionText)) continue;
          const speakerBlocks = Array.from(region.querySelectorAll('img'))
            .map((img) => img.closest('div')?.parentElement)
            .filter(Boolean) as HTMLElement[];

          if (speakerBlocks.length > 0) {
            for (const block of speakerBlocks) {
              const blockText = block.innerText || "";
              if (looksLikeSettings(blockText)) continue;
              const lines = blockText.split('\n').map((l: string) => l.trim()).filter(Boolean);
              if (lines.length >= 2) {
                pushCaption(lines[0], lines.slice(1).join(" "));
              }
            }
          } else {
            const lines = regionText.split('\n').map((l: string) => l.trim()).filter(Boolean);
            if (lines.length >= 2) {
              const speaker = lines[0].length <= 60 ? lines[0] : "Unknown Speaker";
              const text = lines[0].length <= 60 ? lines.slice(1).join(" ") : lines.join(" ");
              pushCaption(speaker, text);
            }
          }
        }
      }

      if (results.length === 0) {
        const bottomCandidates = Array.from(document.querySelectorAll("div, span")) as HTMLElement[];
        const captionBlocks = bottomCandidates
          .filter(visible)
          .filter((node) => !node.closest("button, [role='button'], input, textarea"))
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            if (rect.top < window.innerHeight * 0.45 || rect.bottom > window.innerHeight - 70) return false;
            if (rect.width < 120 || rect.height < 16) return false;
            const text = textOf(node);
            if (text.length < 3 || text.length > 500) return false;
            if (controlText.test(text)) return false;
            return /\p{L}/u.test(text);
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            return br.width * br.height - ar.width * ar.height;
          });

        const seen = new Set<string>();
        // Google Meet's caption overlay, when scraped as a single bottom-of-
        // screen blob, renders multiple speakers concatenated together with
        // each utterance prefixed by the speaker's display name — e.g.
        //   "Jayesh Jadav Right. Ruchit Pithva Google meet my channel.
        //    Jayesh Jadav Welcome. Ruchit Pithva But the …"
        // Calling parseLines() on that dumps the whole blob under
        // `activeSpeakerName`, producing one giant caption attributed to
        // whoever's tile happened to be highlighted at scrape time. Instead,
        // detect the repeated capitalised name prefixes and split into one
        // pushCaption() per utterance. A "name" here = 1–2 Title-Case Latin
        // words that appear ≥2 times in the blob (so a one-off capitalised
        // English word like "Welcome" doesn't get misread as a speaker).
        const splitMultiSpeakerBlob = (raw: string): boolean => {
          const normalized = raw.replace(/\s+/g, " ").trim();
          if (normalized.length < 30) return false;
          const namePattern = /(?:^|(?<=[.?!]\s))([A-Z][a-zA-Z]{1,29}(?:\s+[A-Z][a-zA-Z]{1,29})?)\s+(?=[\p{L}\p{M}])/gu;
          type NameHit = { name: string; index: number; length: number };
          const hits: NameHit[] = [];
          const counts = new Map<string, number>();
          let m: RegExpExecArray | null;
          while ((m = namePattern.exec(normalized)) !== null) {
            const candidate = m[1].trim();
            hits.push({ name: candidate, index: m.index === 0 ? 0 : m.index + (m[0].length - m[1].length - 1), length: m[1].length });
            counts.set(candidate, (counts.get(candidate) ?? 0) + 1);
          }
          const repeated = new Set([...counts.entries()].filter(([, count]) => count >= 2).map(([name]) => name));
          // Need at least 2 distinct repeated names — otherwise it's not a
          // multi-speaker blob, it's just normal sentences that happen to
          // start with capitalised words.
          if (repeated.size < 2) return false;
          const speakerHits = hits.filter((hit) => repeated.has(hit.name));
          if (speakerHits.length < 2) return false;

          let produced = 0;
          for (let i = 0; i < speakerHits.length; i += 1) {
            const hit = speakerHits[i];
            const utteranceStart = hit.index + hit.length;
            const utteranceEnd = i + 1 < speakerHits.length ? speakerHits[i + 1].index : normalized.length;
            const utterance = normalized.slice(utteranceStart, utteranceEnd).trim().replace(/^[\s.,;:-]+/, "");
            if (!utterance || utterance.length < 2) continue;
            pushCaption(hit.name, utterance);
            produced += 1;
          }
          return produced > 0;
        };
        for (const block of captionBlocks.slice(0, 8)) {
          const text = (block.innerText || block.textContent || "").trim();
          const canonical = text.replace(/\s+/g, " ").toLocaleLowerCase("en-US");
          if (seen.has(canonical)) continue;
          seen.add(canonical);
          if (splitMultiSpeakerBlob(text)) {
            if (results.length > 0) break;
            continue;
          }
          parseLines(text, activeSpeakerName);
          if (results.length > 0) break;
        }
      }

      return results;
    }, { currentTimeMs: time.getTime(), selfName: selfName ?? null });
  }

  override async dismissOverlays(): Promise<void> {
    await super.dismissOverlays();
    await this.dismissDeviceNotFoundToast().catch(() => undefined);
  }

  // Google Meet shows a "Microphone not found / Make sure your microphone is
  // plugged in" toast because the bot denies getUserMedia. Click the toast's
  // close icon so it disappears from the live UI; the recording-hide CSS
  // takes care of removing it from the captured video as a backup.
  private async dismissDeviceNotFoundToast(): Promise<void> {
    const page = this.getPage();
    if (page.isClosed()) return;
    await page
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };
        const banners = Array.from(
          document.querySelectorAll('[role="alertdialog"], [role="alert"], [role="status"], [role="region"]')
        ) as HTMLElement[];
        for (const banner of banners) {
          if (!visible(banner)) continue;
          const text = (banner.innerText || banner.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
          if (!/microphone not found|camera not found|microphone is plugged|camera is plugged|no microphone|no camera/.test(text)) continue;
          const closeBtn = banner.querySelector(
            'button[aria-label*="close" i], [role="button"][aria-label*="close" i], button[aria-label*="dismiss" i], [data-tid*="close" i]'
          ) as HTMLElement | null;
          if (closeBtn) {
            closeBtn.click();
            return;
          }
        }
      })
      .catch(() => undefined);
  }

  async hasMeetingEnded(): Promise<boolean> {
    if (this.getPage().isClosed()) return true;
    if (await this.meetingEndedByBodyText([/you left the meeting/i, /return to home screen/i, /rejoin/i])) return true;
    return this.leaveControlMissingForSeveralChecks(/leave call|leave meeting/i);
  }

  private async enableCaptions(): Promise<void> {
    if (this.captionsEnableAttempted) return;
    this.captionsEnableAttempted = true;

    // Defensive cleanup before any clicking — if the profile clone or a
    // previous session left the raise hand state on, lower it first so it
    // doesn't get re-toggled by our attempts.
    await this.lowerRaiseHandIfRaised().catch(() => undefined);

    const initialState = await this.inspectGoogleCaptionState();
    if (initialState.enabled) {
      this.logger.info("google meet captions already enabled");
      return;
    }

    await this.tryEnableCaptions(/* attemptsBudget= */ 3);
  }

  // Capture loop calls this every iteration; cheap when captions are already
  // on (single inspect call), expensive only when we actually retry.
  async ensureCaptionsEnabled(): Promise<void> {
    if (!this.captionsEnableAttempted) return;
    if (this.captionsEnableSucceeded) return;
    // Always lower a stuck raise hand even after we stop retrying captions.
    await this.lowerRaiseHandIfRaised().catch(() => undefined);
    if (this.captionsRetryBudget <= 0) return;
    const state = await this.inspectGoogleCaptionState();
    if (state.enabled) {
      this.captionsEnableSucceeded = true;
      this.logger.info({ state }, "google meet captions confirmed on (capture loop)");
      return;
    }
    this.captionsRetryBudget -= 1;
    await this.tryEnableCaptions(/* attemptsBudget= */ 2);
  }

  private async tryEnableCaptions(attemptsBudget: number): Promise<void> {
    // SAFE strategies only: each positively identifies the CC button by
    // attribute, accessible name, or keyboard shortcut. Positional guessing
    // (compactControls[index] / fixed viewport coordinates) was removed
    // because it can click the wrong button — most commonly Raise Hand, which
    // is adjacent to CC on the toolbar — when the layout shifts.
    const strategies: Array<{ name: string; run: () => Promise<boolean> }> = [
      { name: "locator-click-aria-keyshortcuts", run: () => this.clickGoogleCaptionsButtonViaLocator() },
      { name: "shortcut", run: () => this.pressGoogleCaptionShortcut() },
      { name: "button-by-label", run: () => this.clickGoogleCaptionsButton() }
    ];

    for (let attempt = 0; attempt < Math.min(attemptsBudget, strategies.length); attempt += 1) {
      const strategy = strategies[attempt];
      await this.wakeGoogleToolbar();
      // Lower the raise hand if a prior bad attempt accidentally toggled it
      // on. Cheap no-op when the hand isn't raised.
      await this.lowerRaiseHandIfRaised().catch(() => undefined);
      const fired = await strategy.run().catch(() => false);
      if (!fired) {
        this.logger.debug({ attempt: attempt + 1, strategy: strategy.name }, "google meet captions enable attempt did not fire");
        continue;
      }
      await delay(1500);
      // Verify the click only toggled CC and nothing else.
      await this.lowerRaiseHandIfRaised().catch(() => undefined);
      const state = await this.inspectGoogleCaptionState();
      if (state.enabled) {
        this.captionsEnableSucceeded = true;
        this.logger.info({ attempt: attempt + 1, strategy: strategy.name, state }, "google meet captions enabled");
        return;
      }
      this.logger.info({ attempt: attempt + 1, strategy: strategy.name, state }, "google meet captions still off after attempt; retrying");
    }
  }

  // Safety net for any prior attempt that accidentally clicked the Raise Hand
  // button (it sits right next to CC on the Google Meet toolbar). The bot
  // should never advertise its presence — find an aria-pressed=true raise hand
  // button and toggle it off.
  private async lowerRaiseHandIfRaised(): Promise<void> {
    const page = this.getPage();
    if (page.isClosed()) return;
    const locator = page
      .locator('button[aria-label*="lower hand" i], [role="button"][aria-label*="lower hand" i], button[aria-pressed="true"][aria-label*="raise hand" i], [role="button"][aria-pressed="true"][aria-label*="raise hand" i]')
      .first();
    const visible = await locator.isVisible({ timeout: 200 }).catch(() => false);
    if (!visible) return;
    await locator.click({ timeout: 800 }).catch(() => undefined);
    this.logger.info("google meet raise hand was active — lowered");
  }

  // Use the Playwright locator API for the click so the page sees real
  // PointerDown/Up/Click events instead of a synthetic DOM .click(). Many
  // Google Meet React handlers only react to real pointer events.
  private async clickGoogleCaptionsButtonViaLocator(): Promise<boolean> {
    const page = this.getPage();
    if (page.isClosed()) return false;
    // Try the stable aria-keyshortcuts="c" attribute first, then fall back to
    // accessible-name patterns. Each candidate is gated on visibility.
    const candidates = [
      page.locator('button[aria-keyshortcuts="c"]:not([aria-pressed="true"])').first(),
      page.locator('[role="button"][aria-keyshortcuts="c"]:not([aria-pressed="true"])').first(),
      page.getByRole("button", { name: /turn on captions|captions/i }).first()
    ];
    for (const locator of candidates) {
      const visible = await locator.isVisible({ timeout: 400 }).catch(() => false);
      if (!visible) continue;
      const ariaPressed = await locator.getAttribute("aria-pressed").catch(() => null);
      if (ariaPressed === "true") return false;
      // Hover first so the toolbar control receives the same user-like event
      // sequence (pointerenter → pointerdown → pointerup → click). Without
      // hover, Google's React handlers sometimes silently no-op the click.
      await locator.hover({ timeout: 800 }).catch(() => undefined);
      await delay(100);
      const clicked = await locator
        .click({ timeout: 1500, force: false })
        .then(() => true)
        .catch(() => false);
      if (clicked) {
        this.logger.info("google meet captions clicked via Playwright locator");
        // First-time caption enable on a fresh profile sometimes opens a
        // "Choose caption language" picker. Confirm it so captions actually
        // turn on instead of waiting for a language selection.
        await this.confirmCaptionLanguagePicker().catch(() => undefined);
        return true;
      }
    }
    return false;
  }

  // After clicking the CC button on a fresh profile, Google Meet sometimes
  // pops a "Caption language" dialog. Auto-confirm with the default selection
  // so captions begin immediately rather than waiting for user input.
  private async confirmCaptionLanguagePicker(): Promise<void> {
    const page = this.getPage();
    if (page.isClosed()) return;
    await delay(800);
    const dialogVisible = await page
      .getByRole("dialog", { name: /caption|language|subtitle/i })
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (!dialogVisible) return;
    const confirmButtons = [/^apply$/i, /^save$/i, /^done$/i, /^ok$/i, /^confirm$/i, /turn on/i];
    for (const pattern of confirmButtons) {
      const btn = page.getByRole("button", { name: pattern }).first();
      if (await btn.isVisible({ timeout: 300 }).catch(() => false)) {
        await btn.click({ timeout: 1000 }).catch(() => undefined);
        this.logger.info({ pattern: pattern.toString() }, "google meet caption language picker confirmed");
        return;
      }
    }
  }

  // Move the mouse to the bottom-center of the viewport so Google Meet shows
  // its auto-hiding control bar. Without this, any subsequent click on the
  // captions control can land while the toolbar is collapsed.
  private async wakeGoogleToolbar(): Promise<void> {
    const page = this.getPage();
    if (page.isClosed()) return;
    const viewport = page.viewportSize();
    if (!viewport) return;
    await page.mouse.move(Math.floor(viewport.width / 2), Math.max(1, viewport.height - 30)).catch(() => undefined);
    await delay(400);
  }

  private async waitForGoogleInMeetingControls(): Promise<void> {
    const page = this.getPage();
    const startedAt = Date.now();

    while (Date.now() - startedAt < 20000) {
      const state = await page
        .evaluate(() => {
          const visible = (element: Element): boolean => {
            const node = element as HTMLElement;
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const style = window.getComputedStyle(node);
            return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
          };

          const buttons = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[];
          const visibleButtons = buttons.filter(visible);
          const labels = visibleButtons.map((button) =>
            [
              button.getAttribute("aria-label"),
              button.getAttribute("title"),
              button.getAttribute("data-tooltip"),
              button.getAttribute("aria-keyshortcuts"),
              button.textContent,
              button.innerText,
              button.innerHTML
            ]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim()
          );

          return {
            hasLeave: labels.some((label) => /leave call|leave meeting/i.test(label)),
            hasCaption: labels.some((label) => /caption|closed_caption|\bcc\b/i.test(label)),
            bottomButtonCount: visibleButtons.filter((button) => {
              const rect = button.getBoundingClientRect();
              return rect.top > window.innerHeight * 0.72 && rect.width >= 32 && rect.height >= 32;
            }).length,
            labels: labels.filter((label) => /leave|caption|closed_caption|\bcc\b/i.test(label)).slice(0, 10)
          };
        })
        .catch(() => ({ hasLeave: false, hasCaption: false, bottomButtonCount: 0, labels: [] as string[] }));

      if (state.hasLeave && (state.hasCaption || state.bottomButtonCount >= 8)) {
        this.logger.info({ state }, "google in-meeting controls ready");
        return;
      }

      await page.mouse.move(Math.floor(env.BROWSER_WIDTH / 2), Math.max(1, env.BROWSER_HEIGHT - 30)).catch(() => undefined);
      await delay(500);
    }

    this.logger.warn("google in-meeting controls were not fully detected before caption enable attempt");
  }

  private async inspectGoogleCaptionState(): Promise<{
    enabled: boolean;
    hasTurnOffControl: boolean;
    hasCaptionRegion: boolean;
    captionButtonPressed: boolean;
    labels: string[];
  }> {
    return this.getPage()
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const captionButtons = Array.from(document.querySelectorAll("button, [role='button']"))
          .filter(visible)
          .filter((node) => {
            const shortcut = (node.getAttribute("aria-keyshortcuts") ?? "").toLowerCase().trim();
            if (shortcut === "c") return true;
            const labelBlob = [
              node.getAttribute("aria-label"),
              node.getAttribute("title"),
              node.getAttribute("data-tooltip")
            ]
              .filter(Boolean)
              .join(" ");
            return /caption|closed_caption|\bcc\b|subtitle/i.test(labelBlob);
          });

        const labels = captionButtons.map((node) =>
          [
            node.getAttribute("aria-label"),
            node.getAttribute("title"),
            node.getAttribute("data-tooltip"),
            node.getAttribute("aria-pressed") ? `pressed:${node.getAttribute("aria-pressed")}` : "",
            node.textContent,
            (node as HTMLElement).innerText
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
        );

        const captionButtonPressed = captionButtons.some(
          (node) => node.getAttribute("aria-pressed") === "true"
        );
        const hasTurnOffControl = labels.some((label) =>
          /turn off captions|captions are on|hide captions|stop captions|disable captions|pressed:true/i.test(label)
        );
        // Caption rendering region: Google Meet creates the overlay container
        // *only* when captions are enabled. Presence of a visible region — even
        // empty (no one talking yet) — is a positive signal that captions are
        // on. Previously we required non-empty text, which caused false-negative
        // state during silent moments and led the retry loop to toggle captions
        // back off.
        const hasCaptionRegion = Array.from(
          document.querySelectorAll('[jsname][data-message-text], [class*="captions-container" i], [class*="caption-list" i]')
        ).some(visible);

        return {
          enabled: captionButtonPressed || hasTurnOffControl || hasCaptionRegion,
          hasTurnOffControl,
          hasCaptionRegion,
          captionButtonPressed,
          labels: labels.slice(0, 12)
        };
      })
      .catch(() => ({ enabled: false, hasTurnOffControl: false, hasCaptionRegion: false, captionButtonPressed: false, labels: [] }));
  }

  private async clickGoogleCaptionsButton(): Promise<boolean> {
    return this.getPage()
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const buttons = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[];
        const visibleButtons = buttons.filter(visible);

        // First pass: prefer the captions button by its stable aria-keyshortcuts="c"
        // attribute — Google Meet sets this on the CC button regardless of
        // whether the aria-label text contains "captions" or just an icon.
        for (const button of visibleButtons) {
          const shortcut = (button.getAttribute("aria-keyshortcuts") ?? "").toLowerCase().trim();
          if (shortcut !== "c") continue;
          const ariaPressed = button.getAttribute("aria-pressed");
          if (ariaPressed === "true") return false;
          button.click();
          return true;
        }

        // Fallback: label / tooltip text match.
        for (const button of visibleButtons) {
          const label = [
            button.getAttribute("aria-label"),
            button.getAttribute("title"),
            button.getAttribute("data-tooltip"),
            button.getAttribute("aria-keyshortcuts"),
            button.textContent,
            button.innerText,
            button.innerHTML
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          const ariaPressed = button.getAttribute("aria-pressed");

          if (!/caption|closed_caption|\bcc\b|subtitle/i.test(label)) continue;
          if (/turn off captions|captions are on|hide captions/i.test(label) || ariaPressed === "true") return false;
          if (!/turn on captions|show captions|captions|closed_caption|\bcc\b|subtitle/i.test(label) && ariaPressed !== "false") continue;

          button.click();
          return true;
        }

        return false;
      })
      .catch(() => false);
  }

  private async pressGoogleCaptionShortcut(): Promise<boolean> {
    const page = this.getPage();
    await page.bringToFront().catch(() => undefined);
    const viewport = page.viewportSize();
    if (!viewport) return false;

    // Dismiss any modal/toast that might be stealing focus, then click into
    // the meeting canvas (above the bottom control bar) so the keystroke
    // lands on the meeting and not on a popup.
    await page.keyboard.press("Escape").catch(() => undefined);
    await delay(150);
    await this.dismissDeviceNotFoundToast().catch(() => undefined);
    await page.mouse.click(Math.floor(viewport.width / 2), Math.floor(viewport.height * 0.4)).catch(() => undefined);
    await delay(200);

    // Google's caption shortcut is the bare "c" key (no shift). Press both
    // lowercase and uppercase variants because Playwright maps "KeyC" to
    // shifted "C" depending on the active layout/headless quirks.
    await page.keyboard.press("c").catch(() => undefined);
    await delay(100);
    await page.keyboard.press("KeyC").catch(() => undefined);
    this.logger.info({ viewport }, "google meet pressed captions keyboard shortcut");
    return true;
  }

  private async clickGoogleCaptionControlFixedPosition(): Promise<boolean> {
    const page = this.getPage();
    await page.bringToFront().catch(() => undefined);
    const viewport = page.viewportSize();
    if (!viewport) return false;

    const revealX = Math.floor(viewport.width / 2);
    const revealY = Math.max(1, viewport.height - 30);
    await page.mouse.move(revealX, revealY).catch(() => undefined);
    await delay(400);

    const clickPoint = {
      x: Math.round(viewport.width / 2 + 122),
      y: Math.round(viewport.height - 55)
    };
    this.logger.info({ clickPoint, viewport }, "google meet clicking caption control once by fixed position");
    await page.mouse.click(clickPoint.x, clickPoint.y).catch(() => undefined);
    return true;
  }

  private async clickGoogleCaptionControlByPosition(): Promise<boolean> {
    const page = this.getPage();
    const point = await page
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const buttons = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[];
        const bottomButtons = buttons
          .filter(visible)
          .map((button) => {
            const rect = button.getBoundingClientRect();
            const label = [
              button.getAttribute("aria-label"),
              button.getAttribute("title"),
              button.getAttribute("data-tooltip"),
              button.getAttribute("aria-keyshortcuts"),
              button.textContent,
              button.innerText,
              button.innerHTML
            ]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            return {
              button,
              rect,
              label,
              ariaPressed: button.getAttribute("aria-pressed")
            };
          })
          .filter(({ rect }) => rect.top > window.innerHeight * 0.72 && rect.width >= 32 && rect.width <= 92 && rect.height >= 32 && rect.height <= 92)
          .sort((a, b) => a.rect.left - b.rect.left);

        const explicitCaption = bottomButtons.find(({ label, ariaPressed }) => {
          if (!/caption|closed_caption|\bcc\b/i.test(label)) return false;
          return ariaPressed !== "true" && !/turn off captions|captions are on|hide captions/i.test(label);
        });
        if (explicitCaption) {
          return {
            x: Math.round(explicitCaption.rect.left + explicitCaption.rect.width / 2),
            y: Math.round(explicitCaption.rect.top + explicitCaption.rect.height / 2),
            label: explicitCaption.label
          };
        }

        // Current Google Meet row includes small mic/camera expand arrows:
        // mic arrow, mic, camera arrow, camera, present, reactions, captions, raise hand, more, leave.
        const compactControls = bottomButtons.filter(({ rect }) => rect.width <= 76 && rect.height <= 76);
        const likelyCaption =
          compactControls.find(({ label }) => /closed_caption|caption|\bcc\b/i.test(label)) ??
          compactControls.find(({ label }) => /subtitles|transcript/i.test(label)) ??
          compactControls[6];
        if (!likelyCaption || likelyCaption.ariaPressed === "true") return null;
        return {
          x: Math.round(likelyCaption.rect.left + likelyCaption.rect.width / 2),
          y: Math.round(likelyCaption.rect.top + likelyCaption.rect.height / 2),
          label: likelyCaption.label,
          index: compactControls.indexOf(likelyCaption),
          controls: compactControls.map(({ label, rect }) => ({
            label: label.slice(0, 60),
            left: Math.round(rect.left),
            width: Math.round(rect.width)
          }))
        };
      })
      .catch(() => null);

    if (!point) return false;
    this.logger.info({ point }, "google meet clicking caption control once by position");
    await page.mouse.click(point.x, point.y).catch(() => undefined);
    return true;
  }

  private async clickGooglePeopleButtonToOpen(): Promise<{ clicked: boolean; alreadyOpen: boolean; debug?: Record<string, unknown> }> {
    const result = await this.getPage()
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const peoplePattern = /\b(show everyone|people|participants)\b/i;
        const allButtons = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[];
        const visibleButtons = allButtons.filter(visible);
        const matchingButtons: Array<{ label: string; top: number; left: number; pressed: boolean; expanded: boolean }> = [];

        for (const button of visibleButtons) {
          const label = [
            button.getAttribute("aria-label"),
            button.getAttribute("title"),
            button.getAttribute("data-tooltip"),
            button.textContent
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          if (!peoplePattern.test(label)) continue;

          const rect = button.getBoundingClientRect();
          const pressed = button.getAttribute("aria-pressed") === "true";
          const expanded = button.getAttribute("aria-expanded") === "true";
          
          matchingButtons.push({
            label: label.toLowerCase().slice(0, 80),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            pressed,
            expanded
          });

          if (pressed || expanded) {
            return {
              clicked: false,
              alreadyOpen: true,
              debug: { buttonsScanned: visibleButtons.length, matchingButtons }
            };
          }

          button.click();
          return {
            clicked: true,
            alreadyOpen: false,
            debug: { buttonsScanned: visibleButtons.length, matchingButtons }
          };
        }

        return {
          clicked: false,
          alreadyOpen: false,
          debug: {
            buttonsScanned: visibleButtons.length,
            matchingButtons,
            allButtonLabels: visibleButtons.slice(0, 30).map((b) => {
              const l = [b.getAttribute("aria-label"), b.getAttribute("title"), b.getAttribute("data-tooltip")]
                .filter(Boolean)
                .join(" | ")
                .slice(0, 80);
              const r = b.getBoundingClientRect();
              return `${l || b.textContent?.trim().slice(0, 40)} [${Math.round(r.top)},${Math.round(r.left)}]`;
            })
          }
        };
      })
      .catch(() => ({ clicked: false, alreadyOpen: false, debug: { error: "evaluate_failed" } }));

    return result;
  }

  private async readGooglePeoplePanel(selfName?: string): Promise<{ open: boolean; names: string[]; debug?: Record<string, unknown> }> {
    return this.getPage()
      .evaluate((selfName: string | null) => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const textOf = (element: Element): string => ((element as HTMLElement).innerText || element.textContent || "").replace(/\s+/g, " ").trim();
        const panelCandidates = Array.from(
          document.querySelectorAll("[role='complementary'], [role='dialog'], aside, section, nav, [aria-label*='people' i], [aria-label*='participants' i], div")
        ) as HTMLElement[];

        const matchingPanels = panelCandidates
          .filter(visible)
          .filter((node) => {
            const rect = node.getBoundingClientRect();
            // Panel needs to be somewhat large and on the right side
            if (rect.width < 200 || rect.height < 180) return false;
            if (rect.right < window.innerWidth * 0.5) return false;
            const text = textOf(node);
            return /\bpeople\b|\bparticipants\b|\bin this call\b|\bin the call\b|\bin the meeting\b|\bcontributors\b|\badd others\b/i.test(text);
          })
          .sort((a, b) => {
            const ar = a.getBoundingClientRect();
            const br = b.getBoundingClientRect();
            const aRoster = /\bin this call\b|\bin the call\b|\bin the meeting\b|\bcontributors\b/i.test(textOf(a)) ? 0 : 1;
            const bRoster = /\bin this call\b|\bin the call\b|\bin the meeting\b|\bcontributors\b/i.test(textOf(b)) ? 0 : 1;
            return aRoster - bRoster || ar.width * ar.height - br.width * br.height;
          });

        const panel = matchingPanels[0];

        if (!panel) {
          return {
            open: false,
            names: [],
            debug: {
              totalPanelCandidates: panelCandidates.filter(visible).length,
              viewportWidth: window.innerWidth,
              rightSideElements: panelCandidates
                .filter(visible)
                .filter((n) => {
                  const r = n.getBoundingClientRect();
                  return r.right >= window.innerWidth * 0.6 && r.width >= 150 && r.height >= 100;
                })
                .slice(0, 5)
                .map((n) => ({
                  tag: n.tagName,
                  ariaLabel: n.getAttribute("aria-label")?.slice(0, 60),
                  textSnippet: textOf(n).slice(0, 100)
                }))
            }
          };
        }

        const panelText = textOf(panel);
        const noiseLine =
          /^(people|participants?|contributors?|add others|search for people|in this call|in the call|in the meeting|meeting host|you|presenting|host|co-host|organizer|muted|unmuted|mic|microphone|camera|videocam|captions?|frame|keep|close|more options|pin|remove)$/i;
        const values: string[] = [];
        const rowSelectors = [
          '[data-participant-id]',
          '[role="listitem"]',
          '[aria-label*="participant" i]',
          '[aria-label*="person" i]',
          'div[role="button"][aria-label*="participant" i]'
        ];

        let rowMatchCount = 0;
        for (const node of Array.from(panel.querySelectorAll(rowSelectors.join(",")))) {
          if (!visible(node)) continue;
          rowMatchCount += 1;
          const element = node as HTMLElement;
          const aria = element.getAttribute("aria-label") ?? "";
          const title = element.getAttribute("title") ?? "";
          values.push(aria, title, ...(element.innerText || element.textContent || "").split(/\n+/));
        }

        // Always try text fallback
        const panelLines = (panel.innerText || panel.textContent || "").split(/\n+/).map((l: string) => l.trim()).filter(Boolean);
        values.push(...panelLines);

        const selfLower = (selfName ?? "").toLocaleLowerCase("en-US");
        // Caption text bleeds into the panel.innerText scrape because Google
        // Meet renders the live-caption overlay inside the page DOM. Reject
        // anything that looks like a sentence — real participant rows never
        // carry sentence-ending punctuation or more than ~3 tokens. This is
        // what was leaking "Welcome", "Google", "Emma" (from caption text
        // such as "Jayesh Jadav Welcome." / "Google meet my channel.") into
        // the participants list.
        const looksLikeCaptionLine = (value: string): boolean => {
          if (/[.?!]/.test(value)) return true;
          const tokens = value.split(/\s+/).filter(Boolean);
          return tokens.length > 3;
        };
        const names = values
          .map((value) =>
            value
              .replace(/\b(?:you|presenting|meeting host|host|co-host|organizer|muted|unmuted|in this call|in the call|in the meeting|contributors?)\b/giu, " ")
              .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
              .replace(/\s+/g, " ")
              .trim()
          )
          .filter((value) => value && !noiseLine.test(value))
          .filter((value) => !looksLikeCaptionLine(value))
          .filter((value) => /\p{L}/u.test(value))
          .filter((value) => !/\d/.test(value))
          // Drop the bot's own tile by full-name match BEFORE first-token
          // truncation. Same-first-name real participants survive — only an
          // exact full-name match is excluded.
          .filter((value) => !selfLower || value.toLocaleLowerCase("en-US") !== selfLower)
          .map((value) => value.split(/\s+/)[0])
          .filter((value) => value.length >= 2);

        return {
          open: true,
          names: [...new Set(names)],
          debug: {
            panelTextSnippet: panelText.slice(0, 200),
            rowMatchCount,
            rawValueCount: values.length
          }
        };
      }, selfName ?? null)
      .catch(() => ({ open: false, names: [], debug: { error: "evaluate_failed" } }));
  }

  private async readGoogleMeetVideoTileNames(selfName?: string): Promise<string[]> {
    return this.getPage()
      .evaluate((selfName: string | null) => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const names: string[] = [];
        const selfLower = (selfName ?? "").toLocaleLowerCase("en-US");
        // Material-Icon glyph spans render their ligature key as visible text
        // (e.g. "mic_off", "more_vert", "pin", "keyboard_arrow_up"). Without
        // filtering these out, the naive "first word of textContent" grab
        // returns an icon glyph instead of the participant's name and the
        // cleaner drops it as a stopword — observed live as 60s of
        // `rawParticipantNameCount: 2, observedCount: 0` snapshots.
        const looksLikeIconGlyph = (line: string): boolean => /^[a-z][a-z0-9_]*$/.test(line);
        const tiles = Array.from(document.querySelectorAll('div[data-requested-participant-id], div[data-self-name]')) as HTMLElement[];

        for (const tile of tiles) {
          if (!visible(tile)) continue;
          // Skip the bot's own self-tile so its name never enters the participant list.
          if (tile.hasAttribute("data-self-name")) continue;
          // innerText respects CSS line breaks (textContent collapses them), so
          // the participant name lands on its own line and we can step past
          // icon-glyph / single-letter-avatar prefixes instead of being stuck
          // on the first whitespace-separated token of a concatenated blob.
          const rawText = (tile as HTMLElement).innerText || tile.textContent || "";
          const lines = rawText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
          const nameLine = lines.find((line) => line.length > 1 && !looksLikeIconGlyph(line));
          if (!nameLine) continue;
          const firstToken = nameLine.split(/\s+/)[0];
          if (!firstToken || firstToken.length <= 1) continue;
          if (selfLower && nameLine.toLocaleLowerCase("en-US") === selfLower) continue;
          if (selfLower && firstToken.toLocaleLowerCase("en-US") === selfLower) continue;
          names.push(firstToken);
        }

        return [...new Set(names)];
      }, selfName ?? null).catch(() => []);
  }

  private async debugGoogleMeetDom(): Promise<Record<string, unknown>> {
    return this.getPage()
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
          .filter(visible)
          .map((b) => {
            const el = b as HTMLElement;
            const r = el.getBoundingClientRect();
            return {
              label: [el.getAttribute("aria-label"), el.getAttribute("title")]
                .filter(Boolean)
                .join(" | ")
                .slice(0, 80) || el.textContent?.trim().slice(0, 40),
              pos: `[${Math.round(r.top)},${Math.round(r.left)}]`
            };
          });

        const rightElements = Array.from(document.querySelectorAll("aside, section, nav, [role='complementary'], [role='dialog'], div"))
          .filter(visible)
          .filter(el => {
            const r = el.getBoundingClientRect();
            return r.right > window.innerWidth * 0.6 && r.width > 200 && r.height > 200;
          })
          .map((el) => {
            const node = el as HTMLElement;
            return {
              tag: node.tagName,
              ariaLabel: node.getAttribute("aria-label")?.slice(0, 60),
              textLen: (node.innerText || "").length
            };
          });

        return {
          url: window.location.href,
          buttonCount: buttons.length,
          buttons: buttons.slice(0, 40),
          rightElements: rightElements.slice(0, 10),
          bodyTextSnippet: (document.body.innerText || "").replace(/\s+/g, " ").trim().slice(0, 500)
        };
      })
      .catch((error) => ({ error: String(error).slice(0, 200) }));
  }
}
