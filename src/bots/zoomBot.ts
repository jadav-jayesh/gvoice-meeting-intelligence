import { env } from "../config/env";
import type { CaptionTimelineEntry } from "../types/meeting";
import { delay } from "../utils/async";
import { BaseMeetingBot } from "./baseMeetingBot";
import type { BotJoinContext } from "./types";
import type { Logger } from "pino";

export class ZoomBot extends BaseMeetingBot {
  private captionsEnableAttempted = false;
  private captionsEnableSucceeded = false;
  private captionsRetryBudget = 4;

  constructor(logger: Logger) {
    super(env.ZOOM_USER_DATA_DIR, logger);
  }

  async join(meetingUrl: string, context?: BotJoinContext): Promise<Date> {
    await this.gotoMeeting(meetingUrl);

    // Some entry URLs (the legacy /j/ flow, app launchers) show an interstitial
    // before the WC pre-join page; the wc/<id>/join URL skips it. Try once,
    // ignore if absent.
    await this.clickJoinButton([/join from your browser/i, /launch meeting/i, /open zoom meetings/i]).catch(() => undefined);

    await this.completeZoomPreJoin(context?.meetingPasscode);

    const joinedAt = await this.waitUntilInsideMeeting("zoom join", [/leave/i, /end/i], {
      abortIfEnded: () => this.zoomMeetingEndedDuringPreJoin()
    });
    await this.enableCaptions();
    await this.prepareMeetingView();
    return joinedAt;
  }

  // The Zoom WC pre-join screen renders a "Use microphone and camera?" modal
  // that blocks the passcode + name inputs underneath. The modal often appears
  // a beat after navigation, so we poll for it (and the form) for up to ~20s,
  // dismiss the modal, then fill passcode + name and click Join. The previous
  // single-shot dismissOverlays() call missed the modal when it rendered late,
  // which left the Join button disabled and timed out the join wait.
  private async completeZoomPreJoin(passcode: string | undefined): Promise<void> {
    const deadline = Date.now() + 30000;
    let nameFilled = false;
    let joinClicked = false;
    let consecutiveCleanModalChecks = 0;

    while (Date.now() < deadline) {
      if (await this.zoomMeetingEndedDuringPreJoin()) {
        throw new Error("Zoom meeting was ended by host before bot could join");
      }

      // Zoom shows TWO sequential consent modals on the WC pre-join screen:
      // 1) "Do you want people to see you?" → camera prompt
      // 2) "Do you want people to hear you?" → microphone prompt
      // Each must be dismissed by clicking "Continue without microphone and
      // camera". They render asynchronously, so dismiss every iteration until
      // we see the modal stay gone for several consecutive checks.
      const dismissed = await this.dismissZoomPreJoinModal();
      consecutiveCleanModalChecks = dismissed ? 0 : consecutiveCleanModalChecks + 1;
      if (dismissed) {
        await delay(400);
        continue;
      }

      // Passcode handling: many URLs already encode the passcode in the
      // `pwd=` query param, in which case Zoom does not render a passcode
      // field at all. Try to fill if the input is present, but never block
      // the rest of pre-join on the result.
      if (passcode) {
        await this.fillPasscode(passcode).catch(() => undefined);
      }

      if (!nameFilled) {
        nameFilled = await this.tryFillDisplayName();
      }

      if (!joinClicked && nameFilled && consecutiveCleanModalChecks >= 1) {
        joinClicked = await this.clickZoomJoinButton();
        if (joinClicked) {
          this.logger.info("zoom pre-join Join button clicked");
          break;
        }
      }

      await delay(400);
    }

    if (!joinClicked) {
      this.logger.warn(
        { nameFilled, hadPasscode: Boolean(passcode) },
        "zoom pre-join finished without confirmed Join click; proceeding to in-meeting wait"
      );
    }

    // After the join click, Zoom may show another "use mic/camera" prompt or
    // an "Audio by Computer" choice — dismiss aggressively for a few seconds.
    const postJoinDeadline = Date.now() + 6000;
    while (Date.now() < postJoinDeadline) {
      const handled =
        (await this.dismissZoomPreJoinModal()) ||
        (await this.clickJoinButton([/join audio by computer/i, /computer audio/i]).catch(() => false));
      if (!handled) break;
      await delay(400);
    }
    await this.turnMicAndCameraOff().catch(() => undefined);
  }

  private async dismissZoomPreJoinModal(): Promise<boolean> {
    // Both modals ("see you?" / "hear you?") expose the same dismiss control:
    // "Continue without microphone and camera". Zoom renders it as a styled
    // <a> (not role=button) inside the WC frame, which is why role/text
    // locators on the top page miss it. We walk all frames and click the
    // first matching clickable in the DOM directly.
    return this.clickAcrossFramesByText(
      [
        /^continue without microphone and camera$/i,
        /^continue without microphone$/i,
        /^continue without camera$/i,
        /^continue without$/i
      ],
      "zoom pre-join modal dismiss"
    );
  }

  private async clickZoomJoinButton(): Promise<boolean> {
    if (await this.clickAcrossFramesByText([/^join$/i, /^join meeting$/i], "zoom Join button")) return true;
    return this.clickJoinButton([/^join$/i, /join meeting/i]);
  }

  // Cross-frame click-by-text helper. Walks every frame in the page (the WC
  // app is loaded inside an iframe), finds the first visible clickable element
  // whose trimmed text matches one of the supplied patterns, and clicks it via
  // direct DOM dispatch. This sidesteps role/aria mismatches and frame-
  // boundary issues that defeated getByRole / getByText.
  private async clickAcrossFramesByText(patterns: RegExp[], label: string): Promise<boolean> {
    const page = this.getPage();
    if (page.isClosed()) return false;
    const sources = patterns.map((pattern) => pattern.source);

    for (const frame of page.frames()) {
      const handled = await frame
        .evaluate((patternSources) => {
          const isVisible = (element: Element): boolean => {
            const html = element as HTMLElement;
            if (!html.offsetParent && getComputedStyle(html).position !== "fixed") return false;
            const rect = html.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const style = getComputedStyle(html);
            return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
          };
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>(
              "button, a, [role='button'], [role='link'], div[onclick], span[onclick], [class*='button' i], [class*='btn' i], [class*='link' i]"
            )
          );
          for (const source of patternSources) {
            const re = new RegExp(source, "i");
            for (const element of candidates) {
              const text = (element.innerText || element.textContent || "").trim();
              if (!text || !re.test(text)) continue;
              if (!isVisible(element)) continue;
              element.click();
              return text;
            }
          }
          return null;
        }, sources)
        .catch(() => null);
      if (handled) {
        this.logger.info({ label, frameUrl: frame.url(), text: handled }, "cross-frame click succeeded");
        await delay(250);
        return true;
      }
    }
    return false;
  }

  // Wraps fillDisplayName in a "did this actually fill anything" check so the
  // pre-join loop can know whether the form is reachable yet (vs. still hidden
  // behind a modal). Returns true when a non-empty name input is detected in
  // any frame.
  private async tryFillDisplayName(): Promise<boolean> {
    await this.fillDisplayName().catch(() => undefined);
    const filled = await this.fillNameAcrossFrames(env.BOT_DISPLAY_NAME);
    return filled;
  }

  private async fillNameAcrossFrames(displayName: string): Promise<boolean> {
    const page = this.getPage();
    if (page.isClosed()) return false;
    for (const frame of page.frames()) {
      const filled = await frame
        .evaluate((name) => {
          const inputs = Array.from(document.querySelectorAll<HTMLInputElement>("input"));
          for (const input of inputs) {
            const labelMatch = (
              (input.placeholder || "") +
              " " +
              (input.getAttribute("aria-label") || "") +
              " " +
              (input.name || "") +
              " " +
              (input.id || "")
            ).toLowerCase();
            if (!/name/.test(labelMatch)) continue;
            const rect = input.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            if (!input.value || !input.value.trim()) {
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
              setter?.call(input, name);
              input.dispatchEvent(new Event("input", { bubbles: true }));
              input.dispatchEvent(new Event("change", { bubbles: true }));
            }
            return Boolean(input.value && input.value.trim());
          }
          return false;
        }, displayName)
        .catch(() => false);
      if (filled) {
        this.logger.info({ frameUrl: frame.url() }, "display name filled across frame");
        return true;
      }
    }
    return false;
  }

  private async zoomMeetingEndedDuringPreJoin(): Promise<boolean> {
    if (this.getPage().isClosed()) return true;
    return this.meetingEndedByBodyText([
      /meeting has been ended/i,
      /this meeting has ended/i,
      /host has another meeting in progress/i,
      /meeting id is not valid/i,
      /invalid meeting id/i
    ]);
  }

  async snapshotParticipants(): Promise<string[]> {
    // Click the Participants toggle in whichever frame hosts it.
    await this.clickAcrossFramesByText([/^participants$/i, /^participants \(\d+\)$/i], "zoom Participants toggle").catch(() => undefined);
    await delay(800);

    const names = await this.readTextsFromAllFrames([
      '[aria-label*="participants" i] [role="listitem"]',
      '[class*="participants-item" i]',
      '[class*="participants" i] [role="listitem"]',
      '[class*="participants" i] [role="treeitem"]',
      '[class*="participants" i] li'
    ]);

    await this.hideSidePanels();
    return names;
  }

  private async readTextsFromAllFrames(selectors: string[]): Promise<string[]> {
    const page = this.getPage();
    if (page.isClosed()) return [];
    const seen = new Set<string>();
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const texts = await frame
          .locator(selector)
          .evaluateAll((nodes) =>
            nodes
              .map((node) => (node as HTMLElement).innerText || node.textContent || "")
              .map((text) => text.replace(/\s+/g, " ").trim())
              .filter(Boolean)
          )
          .catch(() => []);
        for (const text of texts) seen.add(text);
      }
    }
    return [...seen];
  }

  async snapshotCaptions(): Promise<Array<Omit<CaptionTimelineEntry, "source">>> {
    // Self-healing: if the join-time enableCaptions silently failed (toolbar
    // not rendered yet, modal still in the way, host hadn't yet allowed
    // captions for participants), retry from inside the capture loop. Cheap
    // once captions are confirmed on.
    await this.ensureCaptionsEnabled().catch(() => undefined);

    const captions = await this.readCaptionBlocks([
      '[aria-live="polite"]',
      '[class*="caption" i]',
      '[class*="closed-caption" i]',
      '[class*="transcript" i]'
    ]);
    if (captions.length > 0) this.captionsEnableSucceeded = true;
    return captions;
  }

  async dismissOverlays(): Promise<void> {
    await super.dismissOverlays();
    // Zoom shows a sticky in-meeting banner: "Please enable access to your
    // microphone and camera for the best experience" with a small × close. We
    // dismiss it every overlay sweep so it never sits in front of controls or
    // captions for long.
    await this.dismissZoomPermissionBanner().catch(() => undefined);
  }

  private async dismissZoomPermissionBanner(): Promise<boolean> {
    const page = this.getPage();
    if (page.isClosed()) return false;
    for (const frame of page.frames()) {
      const handled = await frame
        .evaluate(() => {
          const isVisible = (element: Element): boolean => {
            const html = element as HTMLElement;
            const rect = html.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return false;
            const style = getComputedStyle(html);
            return style.visibility !== "hidden" && style.display !== "none";
          };
          // The banner contains the literal "Please enable access" copy. Find
          // it, then walk to the nearest close button (×) inside the banner
          // container and click it. This avoids matching unrelated × buttons
          // elsewhere on the page.
          const banners = Array.from(document.querySelectorAll<HTMLElement>("body *"));
          for (const node of banners) {
            const text = (node.innerText || node.textContent || "").trim();
            if (!/please enable access to your microphone/i.test(text)) continue;
            if (!isVisible(node)) continue;
            const closer = node.querySelector<HTMLElement>(
              'button[aria-label*="close" i], [role="button"][aria-label*="close" i], button.close, [class*="close" i]'
            );
            if (closer && isVisible(closer)) {
              closer.click();
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
      if (handled) {
        this.logger.info({ frameUrl: frame.url() }, "zoom permission banner dismissed");
        return true;
      }
    }
    return false;
  }

  async hasMeetingEnded(): Promise<boolean> {
    if (this.getPage().isClosed()) return true;
    if (await this.meetingEndedByBodyText([/meeting has been ended/i, /this meeting has ended/i, /you left the meeting/i, /rejoin/i])) {
      // Zoom shows a modal "This meeting has been ended by host" with an OK
      // button rendered in a portal. Click it within ~2s, then return true so
      // the orchestrator proceeds to recorder.stop -> bot.close().
      await Promise.race([this.dismissZoomEndModal(), delay(2000)]);
      return true;
    }
    return this.leaveControlMissingForSeveralChecks(/leave|end/i);
  }

  private async dismissZoomEndModal(): Promise<void> {
    // The "This meeting has been ended by host" OK button lives inside the WC
    // iframe (same as the pre-join modals), so reuse the cross-frame clicker.
    if (await this.clickAcrossFramesByText([/^ok$/i], "zoom end-of-meeting OK")) return;
    if (await this.clickRoleButton(/^ok$/i, 800).catch(() => false)) {
      this.logger.info("zoom end-of-meeting OK clicked (role fallback)");
      return;
    }
    this.logger.warn("zoom end-of-meeting OK button not found; relying on bot.close() to tear down browser");
  }

  protected getRecordingHideSelectors(): string[] {
    return [
      // Live captions overlay (Zoom WC)
      '[class*="live-transcription-subtitle" i]',
      '[class*="closed-caption" i]',
      '[class*="lt-caption" i]',
      '[class*="caption-container" i]',
      '[class*="captions-container" i]',
      // Participants side panel
      '[class*="participants-section" i]',
      '[class*="participants-panel" i]',
      '[aria-label*="participants panel" i]',
      // Chat / "More" side panels — opened only by the bot's data scraping
      '[class*="chat-container" i]',
      '[class*="chat-panel" i]'
    ];
  }

  private async enableCaptions(): Promise<void> {
    if (this.captionsEnableAttempted) return;
    this.captionsEnableAttempted = true;
    if (await this.areCaptionsLikelyOn()) {
      this.captionsEnableSucceeded = true;
      this.logger.info("zoom captions already on");
      return;
    }
    await this.tryEnableCaptions(3);
  }

  // Called from the capture loop on every snapshotCaptions tick. Cheap when
  // captions are already on or the retry budget is exhausted.
  async ensureCaptionsEnabled(): Promise<void> {
    if (!this.captionsEnableAttempted) return;
    if (this.captionsEnableSucceeded) return;
    if (this.captionsRetryBudget <= 0) return;
    if (await this.areCaptionsLikelyOn()) {
      this.captionsEnableSucceeded = true;
      this.logger.info("zoom captions confirmed on (capture loop)");
      return;
    }
    this.captionsRetryBudget -= 1;
    await this.tryEnableCaptions(2);
  }

  private async tryEnableCaptions(attemptsBudget: number): Promise<void> {
    const strategies: Array<{ name: string; run: () => Promise<boolean> }> = [
      { name: "toolbar-show-captions", run: () => this.clickAcrossFramesByText([/^show captions$/i, /^closed caption$/i, /^cc$/i], "zoom captions toggle") },
      { name: "more-menu", run: () => this.openCaptionsViaMoreMenu() },
      { name: "role-button", run: () => this.clickRoleButton(/show captions|closed caption/i, 800).catch(() => false) }
    ];

    for (let attempt = 0; attempt < Math.min(attemptsBudget, strategies.length); attempt += 1) {
      const strategy = strategies[attempt];
      await this.dismissOverlays().catch(() => undefined);
      const fired = await strategy.run().catch(() => false);
      if (!fired) {
        this.logger.debug({ attempt: attempt + 1, strategy: strategy.name }, "zoom captions enable attempt did not fire");
        continue;
      }
      await delay(1500);
      if (await this.areCaptionsLikelyOn()) {
        this.captionsEnableSucceeded = true;
        this.logger.info({ attempt: attempt + 1, strategy: strategy.name }, "zoom captions enabled");
        return;
      }
      this.logger.info({ attempt: attempt + 1, strategy: strategy.name }, "zoom captions still off after attempt");
    }
  }

  private async openCaptionsViaMoreMenu(): Promise<boolean> {
    if (!(await this.clickAcrossFramesByText([/^more$/i, /^more options$/i], "zoom More menu").catch(() => false))) {
      if (!(await this.clickRoleButton(/^more$|^more options$/i, 800).catch(() => false))) return false;
    }
    await delay(400);
    const clicked =
      (await this.clickAcrossFramesByText([/^captions$/i, /^show captions$/i, /^closed caption$/i], "zoom captions in More menu").catch(() => false)) ||
      (await this.clickText(/captions|closed caption|show captions/i, 1000).catch(() => false));
    if (!clicked) return false;
    // Some Zoom builds open a submenu; click "Show Captions" if it appears.
    await delay(400);
    await this.clickAcrossFramesByText([/^show captions$/i, /^enable captions$/i], "zoom captions submenu").catch(() => undefined);
    // Close any lingering menu so it doesn't overlap the meeting view.
    await this.getPage().keyboard.press("Escape").catch(() => undefined);
    return true;
  }

  private async areCaptionsLikelyOn(): Promise<boolean> {
    const page = this.getPage();
    if (page.isClosed()) return false;
    // (a) Toolbar / menu reflects on-state: "Hide Captions" replaces "Show
    // Captions" once captions are active.
    for (const frame of page.frames()) {
      const labelOn = await frame
        .evaluate(() => {
          const candidates = Array.from(
            document.querySelectorAll<HTMLElement>("button, a, [role='button'], [role='menuitem'], [role='menuitemcheckbox']")
          );
          for (const node of candidates) {
            const rect = node.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const style = getComputedStyle(node);
            if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
            const label = [node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim()
              .toLowerCase();
            if (/hide captions|hide closed caption|captions are on/.test(label)) return true;
          }
          return false;
        })
        .catch(() => false);
      if (labelOn) return true;
    }
    // (b) A caption container has been mounted somewhere in the page (the
    // overlay div Zoom uses for live transcript even before any text arrives).
    for (const frame of page.frames()) {
      const containerVisible = await frame
        .evaluate(() => {
          const selectors = [
            '[class*="live-transcription-subtitle" i]',
            '[class*="lt-caption" i]',
            '[class*="closed-caption-container" i]',
            '[class*="caption-container" i]',
            '[class*="captions-container" i]'
          ];
          for (const selector of selectors) {
            for (const node of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
              const rect = node.getBoundingClientRect();
              if (rect.width <= 0 || rect.height <= 0) continue;
              const style = getComputedStyle(node);
              if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
              return true;
            }
          }
          return false;
        })
        .catch(() => false);
      if (containerVisible) return true;
    }
    return false;
  }
}
