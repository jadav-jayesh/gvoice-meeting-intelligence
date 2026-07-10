import path from "node:path";
import { chromium, type BrowserContext, type Locator, type Page } from "playwright";
import type { Logger } from "pino";
import { env } from "../config/env";
import { cfgNumber } from "../config/runtimeConfig";
import { ensureDir } from "../utils/files";
import { delay, withTimeout } from "../utils/async";
import type { BotJoinContext, BotLaunchOptions, MeetingBot } from "./types";
import type { CaptionTimelineEntry } from "../types/meeting";

export abstract class BaseMeetingBot implements MeetingBot {
  protected context?: BrowserContext;
  protected page?: Page;
  private missedLeaveControlChecks = 0;
  protected fullscreenRequested = false;

  protected constructor(
    protected readonly userDataDir: string,
    protected readonly logger: Logger
  ) {}

  async launch(options: BotLaunchOptions): Promise<void> {
    const resolvedUserDataDir = path.resolve(options.userDataDir ?? this.userDataDir);
    await ensureDir(resolvedUserDataDir);
    await ensureDir(options.recordVideoDir);

    // Scope Chromium's audio output to a per-session PulseAudio sink when one
    // is provided by the orchestrator. Without this, parallel bots all play
    // into the host's default sink and ffmpeg captures a mixed signal.
    const launchEnv = options.pulseSink ? { ...process.env, PULSE_SINK: options.pulseSink } : undefined;

    this.context = await chromium.launchPersistentContext(resolvedUserDataDir, {
      headless: env.BROWSER_HEADLESS,
      channel: env.BROWSER_CHANNEL || undefined,
      viewport: { width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT },
      screen: { width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT },
      colorScheme: env.BROWSER_COLOR_SCHEME,
      recordVideo: {
        dir: options.recordVideoDir,
        size: { width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT }
      },
      permissions: [],
      env: launchEnv,
      args: [
        `--window-size=${env.BROWSER_WIDTH},${env.BROWSER_HEIGHT}`,
        "--start-maximized",
        ...(env.BROWSER_HEADLESS ? [] : ["--start-fullscreen"]),
        "--deny-permission-prompts",
        "--disable-infobars",
        "--disable-notifications",
        "--disable-features=Translate,IsolateOrigins,site-per-process",
        ...(env.BROWSER_COLOR_SCHEME === "dark" ? ["--force-dark-mode"] : []),
        "--autoplay-policy=no-user-gesture-required",
        // Hide navigator.webdriver. In HEADED mode (Xvfb) Google Meet detects
        // the AutomationControlled signal and hard-blocks the bot with "You
        // can't join this video call" — verified against a live meeting that a
        // browser launched WITHOUT this flag is blocked while one WITH it
        // reaches the join screen. (Headless wasn't affected, but we run headed
        // for audio capture.)
        "--disable-blink-features=AutomationControlled",
        "--no-first-run"
      ]
    });
    await this.context.clearPermissions().catch(() => undefined);

    // tsx/esbuild wraps nested function declarations with __name(...) to preserve
    // Function.name. When Playwright serializes a page.evaluate body to run in the
    // browser, those references leak in and throw ReferenceError. Define them as
    // no-ops in every page so evaluate bodies execute cleanly.
    await this.context.addInitScript(() => {
      const globalAny = globalThis as unknown as Record<string, unknown>;
      if (typeof globalAny.__name !== "function") {
        globalAny.__name = (target: unknown) => target;
      }
      if (typeof globalAny.__publicField !== "function") {
        globalAny.__publicField = (object: Record<string, unknown>, key: string, value: unknown) => {
          object[key] = value;
          return value;
        };
      }
    });

    await this.context.addInitScript(() => {
      const mediaDevices = navigator.mediaDevices;
      if (!mediaDevices) return;

      const deny = () => Promise.reject(new DOMException("Bot media capture is disabled", "NotAllowedError"));
      Object.defineProperty(mediaDevices, "getUserMedia", {
        configurable: true,
        value: deny
      });
      Object.defineProperty(mediaDevices, "enumerateDevices", {
        configurable: true,
        value: () => Promise.resolve([])
      });
    });

    this.page = this.context.pages()[0] ?? (await this.context.newPage());
    this.page.setDefaultTimeout(3000);
    await this.page.setViewportSize({ width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT });
    await this.enforceBrowserFullscreen("launch");
  }

  abstract join(meetingUrl: string, context?: BotJoinContext): Promise<Date>;
  abstract snapshotParticipants(): Promise<string[]>;
  abstract snapshotCaptions(): Promise<Array<Omit<CaptionTimelineEntry, "source">>>;
  abstract hasMeetingEnded(): Promise<boolean>;

  async leaveMeeting(): Promise<boolean> {
    return this.clickLeaveMeetingControl([/leave call/i, /leave meeting/i, /hang up/i, /^leave$/i]);
  }

  protected async clickLeaveMeetingControl(patterns: RegExp[]): Promise<boolean> {
    const page = this.getPage();
    if (page.isClosed()) return false;

    for (const pattern of patterns) {
      if (await this.clickRoleButton(pattern, 600).catch(() => false)) {
        this.logger.info({ pattern: pattern.toString() }, "leave control clicked");
        await delay(400);
        // Teams often shows a confirmation modal ("Leave call?") after the
        // primary click. Confirm if visible. Other platforms ignore this.
        await this.clickRoleButton(/^leave$/i, 400).catch(() => false);
        await this.clickRoleButton(/leave meeting|leave call|leave anyway/i, 400).catch(() => false);
        return true;
      }
    }
    return false;
  }

  async getMeetingName(): Promise<string | undefined> {
    const page = this.page;
    if (!page || page.isClosed()) return undefined;
    const raw = await page.title().catch(() => "");
    return cleanMeetingTitle(raw);
  }

  async prepareMeetingView(): Promise<void> {
    const page = this.getPage();
    await page.setViewportSize({ width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT }).catch(() => undefined);
    await this.dismissOverlays();
    await this.hideSidePanels();
    await this.ensurePreJoinDevicesOff();
    await this.hideCaptureUiFromRecording();
    await this.enforceBrowserFullscreen("meeting-view");
  }

  // Selectors for UI elements that the bot needs to keep in the DOM (so it
  // can read participant names / captions) but does NOT want appearing in the
  // recorded video. Each platform overrides this with its own list.
  protected getRecordingHideSelectors(): string[] {
    return [];
  }

  // Inject CSS that moves matching elements off-screen (so they don't appear
  // in the video recording) while keeping them in the DOM and CSS-visible (so
  // innerText / textContent still work for the bot's data scraping).
  //
  // Important: NOT `display: none`. innerText returns "" for display:none
  // nodes, which would break captionTracker and participant snapshots.
  // We use absolute positioning + clip-path so the element occupies no
  // viewport pixels but is still rendered for accessibility/text APIs.
  //
  // Tracked per-frame so newly created frames (Zoom WC reloads its iframe)
  // get the CSS re-applied without spamming `<style>` tags into the same
  // frame on every prepareMeetingView call.
  private readonly recordingHideCssAppliedToFrames = new WeakSet<object>();

  protected async hideCaptureUiFromRecording(): Promise<void> {
    const selectors = this.getRecordingHideSelectors();
    if (selectors.length === 0) return;

    const css = `
      ${selectors.join(",\n      ")} {
        position: fixed !important;
        left: -100000px !important;
        top: -100000px !important;
        right: auto !important;
        bottom: auto !important;
        width: 1px !important;
        height: 1px !important;
        max-width: 1px !important;
        max-height: 1px !important;
        opacity: 0 !important;
        pointer-events: none !important;
        z-index: -2147483647 !important;
        transform: none !important;
        clip-path: inset(50%) !important;
      }
    `;

    const page = this.getPage();
    if (page.isClosed()) return;

    let injected = 0;
    for (const frame of page.frames()) {
      if (this.recordingHideCssAppliedToFrames.has(frame)) continue;
      const ok = await frame
        .addStyleTag({ content: css })
        .then(() => true)
        .catch((error) => {
          this.logger.debug({ err: error, frameUrl: frame.url() }, "could not inject recording-hide CSS into frame");
          return false;
        });
      if (ok) {
        this.recordingHideCssAppliedToFrames.add(frame);
        injected += 1;
      }
    }
    if (injected > 0) {
      this.logger.info({ selectorCount: selectors.length, framesInjected: injected }, "recording-hide CSS injected");
    }
  }

  async dismissOverlays(): Promise<void> {
    const page = this.getPage();
    const dismissButtons = [
      /got it/i,
      /not now/i,
      /maybe later/i,
      /skip/i,
      /dismiss/i,
      /^ok$/i,
      /continue without/i,
      /continue/i
    ];

    for (const pattern of dismissButtons) {
      await this.clickRoleButton(pattern, 350).catch(() => undefined);
    }

    if (!this.fullscreenRequested) {
      await page.keyboard.press("Escape").catch(() => undefined);
    }

    // Re-apply recording-hide CSS to any frames that have appeared since the
    // last call (Zoom WC sometimes reloads its iframe; Teams creates panels
    // lazily). The WeakSet inside the helper makes this a no-op for frames
    // already covered, so the only cost on the steady-state path is one
    // page.frames() walk.
    await this.hideCaptureUiFromRecording().catch(() => undefined);
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = undefined;
    this.page = undefined;
    if (!context) return;

    // Hard cap on close so a hung renderer (e.g. blocking modal, native
    // dialog) can't stall the post-meeting pipeline. If graceful close
    // doesn't return in 10s, fall through and let the process move on; the
    // chromium subprocess gets reaped by Playwright on parent exit.
    await Promise.race([
      context.close().catch((error) => this.logger.warn({ err: error }, "browser context close failed")),
      delay(10000).then(() => this.logger.warn("browser context close exceeded 10s — abandoning"))
    ]);
  }

  protected getPage(): Page {
    if (!this.page) throw new Error("Meeting bot has not been launched");
    return this.page;
  }

  protected async gotoMeeting(meetingUrl: string): Promise<void> {
    const page = this.getPage();
    this.logger.info({ meetingUrl }, "navigating to meeting");
    await page.goto(meetingUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await delay(400);
    await this.dismissOverlays();
  }

  protected async waitUntilInsideMeeting(
    label: string,
    patterns: RegExp[],
    options: { abortIfEnded?: () => Promise<boolean> } = {}
  ): Promise<Date> {
    const page = this.getPage();
    let lastStateLogAt = 0;
    let pollCount = 0;

    await withTimeout(
      (async () => {
        while (true) {
          // Cross-frame role lookup: the WC iframe in Zoom (and several other
          // clients) hides the Leave control from top-frame role queries.
          for (const pattern of patterns) {
            if (await this.isRoleButtonVisibleAcrossFrames(pattern, 250)) return;
          }

          // The body-text poll is the most expensive check (~1s). Only run it
          // every few iterations and as a logging snapshot — the role-button
          // probe above is what actually detects the in-meeting state.
          if (pollCount % 3 === 0) {
            const text = await this.readBodyTextAcrossFrames();
            if (/you'?re the only one here|you are the only one here|leave meeting|leave call/i.test(text)) return;
            if (Date.now() - lastStateLogAt > 10000) {
              lastStateLogAt = Date.now();
              this.logger.info(
                {
                  url: page.url(),
                  title: await page.title().catch(() => ""),
                  visibleText: text.replace(/\s+/g, " ").trim().slice(0, 300)
                },
                `${label} waiting for in-meeting controls`
              );
            }

            // If the meeting was ended (or never reachable) before we got
            // inside, fail fast instead of waiting out the full join timeout.
            if (options.abortIfEnded && (await options.abortIfEnded().catch(() => false))) {
              throw new Error(`${label} aborted: meeting ended or unreachable before bot entered`);
            }
          }
          pollCount += 1;
          await delay(400);
        }
      })(),
      (cfgNumber("JOIN_TIMEOUT_MS") ?? env.JOIN_TIMEOUT_MS),
      label
    );

    const joinedAt = new Date();
    this.logger.info({ joinedAt }, "confirmed inside meeting");
    return joinedAt;
  }

  protected async isRoleButtonVisibleAcrossFrames(name: RegExp, timeout = 250): Promise<boolean> {
    const page = this.getPage();
    if (page.isClosed()) return false;
    for (const frame of page.frames()) {
      const visible = await frame
        .getByRole("button", { name })
        .first()
        .isVisible({ timeout })
        .catch(() => false);
      if (visible) return true;
    }
    return false;
  }

  protected async turnMicAndCameraOff(): Promise<void> {
    await this.ensurePreJoinDevicesOff();
  }

  protected async ensurePreJoinDevicesOff(): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const micClicked = await this.ensureDeviceOff("microphone");
      const cameraClicked = await this.ensureDeviceOff("camera");
      if (!micClicked && !cameraClicked) break;
      await delay(200);
    }

    this.logger.info("pre-join microphone and camera off requested");
  }

  protected async ensureDeviceOff(device: "microphone" | "camera"): Promise<boolean> {
    const page = this.getPage();
    const buttons = page.locator("button,[role='button']");
    const count = await buttons.count().catch(() => 0);
    const devicePattern =
      device === "microphone"
        ? /\b(?:mic|microphone|audio|mute|unmute)\b/i
        : /\b(?:camera|video)\b/i;
    const alreadyOffPattern =
      device === "microphone"
        ? /\b(?:unmute|turn on microphone|mic is off|microphone is off|muted|no microphone)\b/i
        : /\b(?:turn on camera|start video|camera is off|video is off|your camera is turned off|no camera)\b/i;
    const shouldClickPattern =
      device === "microphone"
        ? /\b(?:turn off microphone|mute microphone|mute mic|mute$|mic is on|microphone is on)\b/i
        : /\b(?:turn off camera|stop video|camera is on|video is on)\b/i;

    for (let index = 0; index < Math.min(count, 80); index += 1) {
      const button = buttons.nth(index);
      if (!(await button.isVisible({ timeout: 100 }).catch(() => false))) continue;

      const label = await button
        .evaluate((element) => {
          const html = element as HTMLElement;
          return [
            html.getAttribute("aria-label"),
            html.getAttribute("title"),
            html.getAttribute("data-tid"),
            html.innerText,
            html.textContent
          ]
            .filter(Boolean)
            .join(" ");
        })
        .catch(() => "");
      const normalizedLabel = label.replace(/\s+/g, " ").trim();
      if (!devicePattern.test(normalizedLabel)) continue;
      if (alreadyOffPattern.test(normalizedLabel)) continue;

      const ariaPressed = await button.getAttribute("aria-pressed").catch(() => null);
      const checked = await button.getAttribute("aria-checked").catch(() => null);
      const explicitOn = shouldClickPattern.test(normalizedLabel);
      const pressedOn = ariaPressed === "true" || checked === "true";

      if (explicitOn || pressedOn) {
        await button.click({ timeout: 800 }).catch(async () => {
          await button.evaluate((element) => (element as HTMLElement).click());
        });
        this.logger.info({ device, label: normalizedLabel }, "pre-join device toggle clicked off");
        return true;
      }
    }

    return false;
  }

  protected async clickJoinButton(patterns: RegExp[]): Promise<boolean> {
    for (const pattern of patterns) {
      const clicked = await this.clickRoleButton(pattern, 1000).catch(() => false);
      if (clicked) return true;
      const textClicked = await this.clickText(pattern, 1000).catch(() => false);
      if (textClicked) return true;
    }
    return false;
  }

  protected async clickRoleButton(name: RegExp, timeout = 500): Promise<boolean> {
    const page = this.getPage();
    const locator = page.getByRole("button", { name }).first();
    return this.clickIfVisible(locator, timeout);
  }

  protected async clickText(text: RegExp, timeout = 500): Promise<boolean> {
    const page = this.getPage();
    const locator = page.getByText(text).first();
    return this.clickIfVisible(locator, timeout);
  }

  protected async clickSelector(selector: string, timeout = 500): Promise<boolean> {
    const page = this.getPage();
    const locator = page.locator(selector).first();
    return this.clickIfVisible(locator, timeout);
  }

  protected async clickIfVisible(locator: Locator, timeout = 500): Promise<boolean> {
    const visible = await locator.isVisible({ timeout }).catch(() => false);
    if (!visible) return false;
    await locator.click({ timeout: Math.max(timeout, 1000) }).catch(async () => {
      await locator.evaluate((element) => (element as HTMLElement).click());
    });
    await delay(350);
    return true;
  }

  protected async isRoleButtonVisible(name: RegExp, timeout = 500): Promise<boolean> {
    const page = this.getPage();
    return page.getByRole("button", { name }).first().isVisible({ timeout }).catch(() => false);
  }

  protected async fillPasscode(passcode: string | undefined): Promise<boolean> {
    if (!passcode) return false;
    const page = this.getPage();
    const selectors = [
      'input[type="password"]',
      'input[aria-label*="passcode" i]',
      'input[aria-label*="password" i]',
      'input[placeholder*="passcode" i]',
      'input[placeholder*="password" i]',
      'input[name*="passcode" i]',
      'input[name*="password" i]'
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 700 }).catch(() => false)) {
        const value = await locator.inputValue().catch(() => "");
        if (!value.trim()) await locator.fill(passcode);
        this.logger.info({ selector }, "meeting passcode filled");
        return true;
      }
    }
    return false;
  }

  protected async fillDisplayName(): Promise<void> {
    const page = this.getPage();
    const selectors = [
      'input[placeholder*="name" i]',
      'input[aria-label*="name" i]',
      'input[name*="name" i]',
      'input[type="text"]'
    ];

    for (const selector of selectors) {
      const locator = page.locator(selector).first();
      if (await locator.isVisible({ timeout: 700 }).catch(() => false)) {
        const value = await locator.inputValue().catch(() => "");
        if (!value.trim()) await locator.fill(env.BOT_DISPLAY_NAME);
        return;
      }
    }
  }

  protected async hideSidePanels(): Promise<void> {
    const closeButtons = [/close participants/i, /close people/i, /close chat/i, /close panel/i, /^close$/i];
    for (const pattern of closeButtons) {
      await this.clickRoleButton(pattern, 250).catch(() => undefined);
    }
    if (!this.fullscreenRequested) {
      await this.getPage().keyboard.press("Escape").catch(() => undefined);
    }
  }

  protected async readTextsFromSelectors(selectors: string[]): Promise<string[]> {
    const page = this.getPage();
    const values: string[] = [];

    for (const selector of selectors) {
      const texts = await page
        .locator(selector)
        .evaluateAll((nodes) =>
          nodes
            .map((node) => (node as HTMLElement).innerText || node.textContent || "")
            .map((text) => text.replace(/\s+/g, " ").trim())
            .filter(Boolean)
        )
        .catch(() => []);
      values.push(...texts);
    }

    return [...new Set(values)];
  }

  protected async readCaptionBlocks(selectors: string[]): Promise<Array<Omit<CaptionTimelineEntry, "source">>> {
    const time = new Date();
    const blocks = await this.readRawTextsFromSelectors(selectors);
    return blocks.flatMap((block) => parseCaptionBlocksFromText(block, time)).filter((caption): caption is Omit<CaptionTimelineEntry, "source"> => Boolean(caption));
  }

  protected async readRawTextsFromSelectors(selectors: string[]): Promise<string[]> {
    const page = this.getPage();
    const values: string[] = [];

    for (const selector of selectors) {
      const texts = await page
        .locator(selector)
        .evaluateAll((nodes) =>
          nodes
            .map((node) => (node as HTMLElement).innerText || node.textContent || "")
            .map((text) => text.trim())
            .filter(Boolean)
        )
        .catch(() => []);
      values.push(...texts);
    }

    return [...new Set(values)];
  }

  protected async meetingEndedByBodyText(patterns: RegExp[]): Promise<boolean> {
    const text = await this.readBodyTextAcrossFrames();
    return patterns.some((pattern) => pattern.test(text));
  }

  // Some meeting clients (notably Zoom WC) render the entire app inside an
  // iframe. Reading body innerText from only the top frame misses everything
  // that matters — modals, end-of-meeting banners, even the in-meeting
  // controls. This concatenates innerText from every reachable frame so any
  // pattern check sees the same text the user does.
  protected async readBodyTextAcrossFrames(): Promise<string> {
    const page = this.getPage();
    if (page.isClosed()) return "";
    const parts: string[] = [];
    for (const frame of page.frames()) {
      const text = await frame.locator("body").innerText({ timeout: 600 }).catch(() => "");
      if (text) parts.push(text);
    }
    return parts.join("\n");
  }

  protected async leaveControlMissingForSeveralChecks(name: RegExp, requiredMisses = 4): Promise<boolean> {
    // Cross-frame check — Zoom (and other clients that wrap their UI in an
    // iframe) hide the Leave button from top-frame role queries. Using the
    // top-frame-only probe here caused false "meeting ended" detections that
    // auto-left the bot ~8s after joining (4 misses × CAPTURE_INTERVAL_MS).
    const visible = await this.isRoleButtonVisibleAcrossFrames(name, 500);
    if (visible) {
      this.missedLeaveControlChecks = 0;
      return false;
    }

    this.missedLeaveControlChecks += 1;
    return this.missedLeaveControlChecks >= requiredMisses;
  }

  protected async enforceBrowserFullscreen(reason: string): Promise<void> {
    if (env.BROWSER_HEADLESS) return;

    const page = this.getPage();
    await page.bringToFront().catch(() => undefined);

    try {
      const session = await this.context?.newCDPSession(page);
      const windowInfo = await session?.send("Browser.getWindowForTarget");
      if (session && windowInfo?.windowId !== undefined) {
        await session.send("Browser.setWindowBounds", {
          windowId: windowInfo.windowId,
          bounds: {
            windowState: "fullscreen"
          }
        });
        await session.detach().catch(() => undefined);
        this.fullscreenRequested = true;
        this.logger.info({ reason, width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT }, "browser fullscreen applied via CDP");
        return;
      }
    } catch (error) {
      this.logger.warn({ err: error, reason }, "browser fullscreen via CDP failed; falling back to F11");
    }

    await page.keyboard.press("F11").catch(() => undefined);
    await delay(250);
    this.fullscreenRequested = true;
    this.logger.info({ reason, width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT }, "browser F11 fullscreen requested");
  }
}

function parseCaptionBlocksFromText(block: string, time: Date): Array<Omit<CaptionTimelineEntry, "source">> {
  const normalized = block.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length < 2) return [];

  const colon = normalized.match(/^([^:]{2,60}):\s*(.+)$/);
  if (colon && !block.includes("\n")) {
    return [{ speaker: colon[1].trim(), text: colon[2].trim(), time }];
  }

  const lines = block
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) return [];

  const results: Array<Omit<CaptionTimelineEntry, "source">> = [];
  let currentSpeaker: string | null = null;
  let currentText: string[] = [];

  const flush = () => {
    if (currentSpeaker && currentText.length > 0) {
      results.push({ speaker: currentSpeaker, text: currentText.join(" "), time });
    }
    currentSpeaker = null;
    currentText = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // A line is considered a new speaker if it is short, doesn't end in typical sentence punctuation,
    // and is not the last line (a speaker must have text following them).
    // Also, if we already have text, we assume alternating speaker/text.
    const isLikelySpeaker =
      line.length <= 45 &&
      !/[.!?]$/.test(line) &&
      i < lines.length - 1;

    if (!currentSpeaker) {
      if (line.length <= 60) {
        currentSpeaker = line;
      } else {
        currentSpeaker = "Unknown Speaker";
        currentText.push(line);
      }
    } else {
      if (currentText.length > 0 && isLikelySpeaker) {
        flush();
        currentSpeaker = line;
      } else {
        currentText.push(line);
      }
    }
  }

  flush();
  return results;
}

// Strip generic platform decorations from a browser tab title so the saved
// meeting name is the human-friendly part. Returns undefined when the title
// is just the app shell (e.g. "Microsoft Teams") with no meeting-specific
// content — callers fall back to other sources (Graph subject, Zoom topic).
export function cleanMeetingTitle(raw: string): string | undefined {
  const trimmed = raw?.replace(/\s+/g, " ").trim();
  if (!trimmed) return undefined;

  // Drop common " | Microsoft Teams", " - Google Meet", " - Zoom" suffixes
  // and any leading "Meet - " / "Meet – " prefix Meet uses for its tab.
  let cleaned = trimmed
    .replace(/\s*[|\-–—]\s*(?:Microsoft Teams|Google Meet|Zoom(?: Workplace| Meeting)?|Meet)\s*$/i, "")
    .replace(/^\s*Meet\s*[\-–—]\s*/i, "")
    .replace(/^\s*\(\d+\)\s*/, "") // strip "(1) " unread-counter prefix
    .trim();

  if (!cleaned) return undefined;
  const generic = /^(?:microsoft teams|google meet|zoom(?: workplace| meeting)?|meet)$/i;
  if (generic.test(cleaned)) return undefined;
  return cleaned;
}
