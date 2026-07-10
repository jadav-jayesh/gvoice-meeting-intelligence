import { env } from "../config/env";
import type { CaptionTimelineEntry } from "../types/meeting";
import { delay } from "../utils/async";
import { BaseMeetingBot } from "./baseMeetingBot";
import type { Logger } from "pino";

export class MicrosoftTeamsBot extends BaseMeetingBot {
  private panelBelievedOpen = false;
  private panelOpenAttempts = 0;
  private static readonly MAX_PANEL_OPEN_ATTEMPTS = 12;
  private lastPanelNames: string[] = [];
  private lastParticipantSnapshotDebug: Record<string, unknown> | undefined;
  private captionsEnableAttempted = false;
  private captionsEnableSucceeded = false;
  private captionsRetryBudget = 4;

  constructor(logger: Logger) {
    super(env.TEAMS_USER_DATA_DIR, logger);
  }

  async join(meetingUrl: string): Promise<Date> {
    await this.gotoMeeting(meetingUrl);
    await this.handleTeamsWebClientEntry();
    await this.completePreJoinDeviceFlow();

    const joinedAt = await this.waitUntilInsideMeeting("microsoft teams join", [/leave/i, /hang up/i]);
    await this.dismissTeamsDevicePermissionUi(12);
    await this.enableCaptions();
    await this.dismissTeamsDevicePermissionUi(12);
    await this.prepareMeetingView();
    return joinedAt;
  }

  override async prepareMeetingView(): Promise<void> {
    const page = this.getPage();
    await page.setViewportSize({ width: env.BROWSER_WIDTH, height: env.BROWSER_HEIGHT }).catch(() => undefined);
    await this.dismissOverlays();
    await this.dismissTeamsDevicePermissionUi(12);
    await this.enforceBrowserFullscreen("teams-meeting-view");
  }

  async snapshotParticipants(): Promise<string[]> {
    await this.dismissTeamsDevicePermissionUi(4);
    let panelReadable = false;

    // ── Strategy 1: Read the panel if it's already open ──
    let snapshot = await this.readTeamsParticipantPanel();
    this.lastParticipantSnapshotDebug = { strategy: "initial_panel_read", panelOpenAttempts: this.panelOpenAttempts, ...snapshot.debug };
    if (snapshot.open) panelReadable = true;

    if (snapshot.open && snapshot.names.length > 0) {
      this.panelBelievedOpen = true;
      this.lastPanelNames = snapshot.names;
      this.panelOpenAttempts = 0;
      this.lastParticipantSnapshotDebug = { strategy: "panel_read", names: snapshot.names, ...snapshot.debug };
      this.logger.info({ names: snapshot.names, strategy: "panel_read" }, "teams participants from open panel");
      return [...new Set(snapshot.names)];
    }

    // Log debug info when panel read fails
    this.logger.info(
      { panelOpen: snapshot.open, panelNameCount: snapshot.names.length, debug: snapshot.debug, attempt: this.panelOpenAttempts },
      "teams participant panel read — panel empty or closed"
    );

    // ── Strategy 2: Try to open the panel (button click + keyboard shortcut) ──
    if (this.panelOpenAttempts < MicrosoftTeamsBot.MAX_PANEL_OPEN_ATTEMPTS) {
      this.panelOpenAttempts += 1;
      await this.revealTeamsMeetingToolbar();

      // 2a: Click the people/participants button (try without position filter)
      const clickResult = await this.clickTeamsPeopleButtonToOpen();
      this.lastParticipantSnapshotDebug = {
        strategy: "open_panel_attempt",
        panelOpenAttempts: this.panelOpenAttempts,
        clickResult,
        panelReadDebug: snapshot.debug
      };
      this.logger.info(
        { clickResult, attempt: this.panelOpenAttempts },
        "teams people button click result"
      );

      if (clickResult.clicked || clickResult.alreadyOpen) {
        await delay(2500);
        snapshot = await this.readTeamsParticipantPanel();
        if (snapshot.open) panelReadable = true;
        if (snapshot.open && snapshot.names.length > 0) {
          this.panelBelievedOpen = true;
          this.lastPanelNames = snapshot.names;
          this.panelOpenAttempts = 0;
          this.lastParticipantSnapshotDebug = { strategy: "button_click", names: snapshot.names, clickResult, ...snapshot.debug };
          this.logger.info({ names: snapshot.names, strategy: "button_click" }, "teams participants from panel after button click");
          return [...new Set(snapshot.names)];
        }
        this.lastParticipantSnapshotDebug = { strategy: "button_click_empty_panel", clickResult, ...snapshot.debug };
        this.logger.info({ panelOpen: snapshot.open, debug: snapshot.debug }, "teams panel opened by click but no names extracted");
      }

      // 2b: Keyboard shortcut fallback
      if (!clickResult.clicked && !clickResult.alreadyOpen) {
        const fallbackClicked = await this.clickTeamsPeopleButtonFallback();
        if (fallbackClicked) {
          await delay(2500);
          snapshot = await this.readTeamsParticipantPanel();
          if (snapshot.open) panelReadable = true;
          if (snapshot.open && snapshot.names.length > 0) {
            this.panelBelievedOpen = true;
            this.lastPanelNames = snapshot.names;
            this.panelOpenAttempts = 0;
            this.lastParticipantSnapshotDebug = { strategy: "selector_fallback", names: snapshot.names, ...snapshot.debug };
            this.logger.info({ names: snapshot.names, strategy: "selector_fallback" }, "teams participants from panel after selector fallback");
            return [...new Set(snapshot.names)];
          }
          this.lastParticipantSnapshotDebug = { strategy: "selector_fallback_empty_panel", ...snapshot.debug };
        }
      }
    }

    // If the participant panel was readable but contained no other names, the
    // meeting truly has only the bot (everyone else left, or no one else has
    // joined yet). Don't fall back to body-text tile scraping — that path
    // misreads the captions stream as participant names.
    if (panelReadable) {
      this.lastParticipantSnapshotDebug = {
        strategy: "panel_open_no_others",
        panelOpenAttempts: this.panelOpenAttempts,
        ...snapshot.debug
      };
      this.logger.info(
        { debug: snapshot.debug, panelOpenAttempts: this.panelOpenAttempts },
        "teams participant panel open but no other participants present"
      );
      return [];
    }

    // ── Strategy 3: Read participant names from video tiles (ONLY when the
    // panel could not be read at all — never as a fallback for an empty panel).
    const tileNames = await this.readTeamsVideoTileNames();
    if (tileNames.length > 0) {
      this.logger.info({ tileNames, strategy: "video_tiles" }, "teams participants scraped from video tiles");
      this.lastParticipantSnapshotDebug = { strategy: "video_tiles", names: tileNames, panelOpenAttempts: this.panelOpenAttempts };
      this.lastPanelNames = tileNames;
      return [...new Set(tileNames)];
    }

    // ── Strategy 4: Full page DOM debug dump (for diagnostics) ──
    if (this.panelOpenAttempts >= MicrosoftTeamsBot.MAX_PANEL_OPEN_ATTEMPTS && this.lastPanelNames.length === 0) {
      const domDebug = await this.debugTeamsMeetingDom();
      this.lastParticipantSnapshotDebug = { strategy: "all_strategies_failed", domDebug, panelOpenAttempts: this.panelOpenAttempts };
      this.logger.warn(
        { domDebug, panelOpenAttempts: this.panelOpenAttempts },
        "teams participant extraction failed all strategies — DOM debug dump"
      );
    }

    // No reliable signal at all — return empty rather than the cached/fallback
    // names so the auto-leave timer can advance on truly silent meetings.
    return [];
  }

  getLastParticipantSnapshotDebug(): Record<string, unknown> | undefined {
    return this.lastParticipantSnapshotDebug;
  }

  async snapshotCaptions(): Promise<Array<Omit<CaptionTimelineEntry, "source">>> {
    // Self-healing: if the initial enableCaptions during join silently failed
    // (common under concurrent sessions racing the More-menu / keyboard
    // shortcut), retry from inside the capture loop. Cheap when already on.
    await this.ensureCaptionsEnabled().catch(() => undefined);

    const selectorCaptions = await this.readCaptionBlocks([
      '[data-tid*="caption" i]',
      '[aria-live="polite"]',
      '[class*="caption" i]',
      '[class*="transcript" i]'
    ]);
    if (selectorCaptions.length > 0) {
      // Captions are flowing — mark as confirmed so we stop retrying.
      this.captionsEnableSucceeded = true;
      return selectorCaptions;
    }

    const bodyText = await this.getPage().locator("body").innerText({ timeout: 1000 }).catch(() => "");
    const bodyCaptions = parseTeamsCaptionText(bodyText, new Date());
    if (bodyCaptions.length > 0) this.captionsEnableSucceeded = true;
    return bodyCaptions;
  }

  async hasMeetingEnded(): Promise<boolean> {
    if (this.getPage().isClosed()) return true;
    if (await this.meetingEndedByBodyText([/you'?ve left the meeting/i, /call ended/i, /meeting has ended/i, /rejoin/i])) return true;
    // Teams auto-hides the in-call toolbar (incl. the Leave button) once the
    // pointer is idle. The bot never moves the mouse, so on a LIVE meeting the
    // Leave button disappears from the DOM — which previously tripped a false
    // "meeting ended" after only 4 checks (~8s) and made the bot leave a
    // running call mid-conversation. If the button isn't currently visible,
    // nudge the pointer to reveal the toolbar before trusting the probe, and
    // require a longer sustained absence (8 checks ≈ 16s) before concluding the
    // call is over. A genuine end is still caught instantly by the body-text
    // check above ("call ended" / "rejoin"), so this only delays the rare
    // text-less end by a few seconds while eliminating the false positives.
    if (!(await this.isRoleButtonVisibleAcrossFrames(/leave|hang up/i, 400))) {
      await this.wakeMeetingControls();
    }
    return this.leaveControlMissingForSeveralChecks(/leave|hang up/i, 8);
  }

  // Reveal Teams' auto-hidden meeting toolbar by moving the pointer over the
  // bottom-centre control strip (then a little, to fire the mousemove handler).
  // Pure reveal — it never clicks, so it can't accidentally leave or mute.
  private async wakeMeetingControls(): Promise<void> {
    const page = this.getPage();
    if (page.isClosed()) return;
    const x = Math.round(env.BROWSER_WIDTH / 2);
    const yBottom = Math.max(1, env.BROWSER_HEIGHT - 40);
    await page.mouse.move(x, yBottom, { steps: 3 }).catch(() => undefined);
    await page.mouse.move(x + 24, Math.round(env.BROWSER_HEIGHT / 2), { steps: 3 }).catch(() => undefined);
  }

  override async dismissOverlays(): Promise<void> {
    await super.dismissOverlays();
    await this.dismissTeamsDevicePermissionUi(3);
  }

  private async enableCaptions(): Promise<void> {
    if (this.captionsEnableAttempted) return;
    this.captionsEnableAttempted = true;
    await this.dismissTeamsDevicePermissionUi(4);
    if (await this.areCaptionsLikelyOn()) {
      this.captionsEnableSucceeded = true;
      this.logger.info("teams captions already on");
      return;
    }
    await this.tryEnableCaptions(3);
  }

  // Called from the capture loop. Cheap (one DOM probe) when already on or
  // when the retry budget is exhausted; only does real work when the join-time
  // enable silently failed.
  async ensureCaptionsEnabled(): Promise<void> {
    if (!this.captionsEnableAttempted) return;
    if (this.captionsEnableSucceeded) return;
    if (this.captionsRetryBudget <= 0) return;
    if (await this.areCaptionsLikelyOn()) {
      this.captionsEnableSucceeded = true;
      this.logger.info("teams captions confirmed on (capture loop)");
      return;
    }
    this.captionsRetryBudget -= 1;
    await this.tryEnableCaptions(2);
  }

  private async tryEnableCaptions(attemptsBudget: number): Promise<void> {
    const strategies: Array<{ name: string; run: () => Promise<boolean> }> = [
      { name: "shortcut", run: () => this.pressTeamsCaptionShortcut() },
      { name: "more-menu", run: () => this.openCaptionsViaMoreMenu() },
      { name: "role-button", run: () => this.clickRoleButton(/turn on live captions|live captions/i, 800).catch(() => false) }
    ];

    for (let attempt = 0; attempt < Math.min(attemptsBudget, strategies.length); attempt += 1) {
      const strategy = strategies[attempt];
      await this.revealTeamsMeetingToolbar();
      await this.dismissTeamsDevicePermissionUi(2);
      const fired = await strategy.run().catch(() => false);
      if (!fired) {
        this.logger.debug({ attempt: attempt + 1, strategy: strategy.name }, "teams captions enable attempt did not fire");
        continue;
      }
      await delay(1200);
      if (await this.areCaptionsLikelyOn()) {
        this.captionsEnableSucceeded = true;
        this.logger.info({ attempt: attempt + 1, strategy: strategy.name }, "teams captions enabled");
        return;
      }
      this.logger.info({ attempt: attempt + 1, strategy: strategy.name }, "teams captions still off after attempt");
    }

    if (!this.captionsEnableSucceeded) {
      const captionState = await this.inspectTeamsCaptionMenuState();
      this.logger.warn({ captionState }, "teams captions control unavailable or disabled");
    }
  }

  private async pressTeamsCaptionShortcut(): Promise<boolean> {
    for (const shortcut of ["Control+Shift+L", "Meta+Shift+L"]) {
      await this.getPage().keyboard.press(shortcut).catch(() => undefined);
      await delay(500);
      if (await this.areCaptionsLikelyOn()) return true;
    }
    return false;
  }

  private async openCaptionsViaMoreMenu(): Promise<boolean> {
    if (!(await this.clickRoleButton(/^more$|^more actions$|more options/i, 800).catch(() => false))) return false;
    await delay(400);
    const clicked =
      (await this.clickText(/language and speech/i, 1000).catch(() => false)) ||
      (await this.clickText(/turn on live captions|live captions|^captions$/i, 1000).catch(() => false));
    if (!clicked) return false;
    await delay(500);
    // The "Language and speech" path opens a submenu — click the captions toggle.
    await this.clickText(/turn on live captions|^live captions$|^captions$/i, 800).catch(() => false);
    // Close any lingering menu by pressing Escape so it doesn't block the meeting view.
    await this.getPage().keyboard.press("Escape").catch(() => undefined);
    return true;
  }

  private async areCaptionsLikelyOn(): Promise<boolean> {
    if (await this.hasVisibleTeamsLabel(["hide captions", "turn off live captions", "captions are turned on"])) return true;
    return this.getPage()
      .evaluate(() => {
        const selectors = [
          '[data-tid*="caption" i]',
          '[data-tid*="closed-caption" i]',
          '[class*="caption-container" i]',
          '[class*="captionsContainer" i]'
        ];
        for (const selector of selectors) {
          const nodes = Array.from(document.querySelectorAll(selector));
          for (const node of nodes) {
            const element = node as HTMLElement;
            const rect = element.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) continue;
            const style = window.getComputedStyle(element);
            if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
            return true;
          }
        }
        return false;
      })
      .catch(() => false);
  }

  protected override async ensurePreJoinDevicesOff(): Promise<void> {
    await this.setTeamsControlOff(
      {
        offStateLabels: ["unmute", "microphone off", "audio off", "mic off", "no microphone"],
        turnOffLabels: ["mute", "mute mic", "microphone on", "mic on"]
      },
      ["Control+Shift+M", "Meta+Shift+M"],
      "microphone"
    );

    await this.setTeamsControlOff(
      {
        offStateLabels: ["camera off", "turn camera on", "start video", "video off", "your camera is turned off", "no camera"],
        turnOffLabels: ["camera on", "turn camera off", "stop video", "video on"]
      },
      ["Control+Shift+O", "Meta+Shift+O"],
      "camera"
    );

    this.logger.info("teams pre-join microphone and camera off verified/requested");
  }

  private async handleTeamsWebClientEntry(): Promise<void> {
    const page = this.getPage();
    const startedAt = Date.now();

    while (Date.now() - startedAt < 45000) {
      await this.clickJoinButton([
        /continue on this browser/i,
        /continue in this browser/i,
        /join on the web/i,
        /use the web app/i,
        /join from this browser/i,
        /join meeting/i
      ]).catch(() => false);

      await this.handleNoAudioVideoPrompt();
      await this.dismissTeamsDeviceToasts();

      const hasNameInput = await page.locator('input[placeholder*="name" i], input[aria-label*="name" i], input[type="text"]').first().isVisible({ timeout: 350 }).catch(() => false);
      const hasJoinNow = await this.isRoleButtonVisible(/join now/i, 350);
      if (hasNameInput || hasJoinNow) return;

      await delay(180);
    }
  }

  private async completePreJoinDeviceFlow(): Promise<void> {
    const page = this.getPage();

    // One-shot prep: name, audio mode and mic/cam off only need to happen once
    // before the Join now button is enabled. Running them on every poll iteration
    // was costing 3–4 seconds per attempt.
    await this.handleNoAudioVideoPrompt();
    await this.dismissTeamsDeviceToasts();
    await this.fillDisplayName();
    await this.selectTeamsAudioMode();
    await this.ensurePreJoinDevicesOff();

    for (let attempt = 1; attempt <= 40; attempt += 1) {
      // Every few attempts re-run device prep in case the Teams pre-join UI
      // re-renders (it sometimes resets toggles when the meeting starts).
      if (attempt > 1 && attempt % 6 === 0) {
        await this.ensurePreJoinDevicesOff();
      }
      await this.handleNoAudioVideoPrompt();
      await this.dismissTeamsDeviceToasts();

      const clicked = await this.clickJoinButton([/join now/i, /^join$/i]);
      if (clicked) {
        this.logger.info({ attempt }, "teams join now clicked");
        await delay(500);
        await this.handleNoAudioVideoPrompt();
        return;
      }

      if (attempt === 1 || attempt % 8 === 0) {
        const bodyText = await page.locator("body").innerText({ timeout: 600 }).catch(() => "");
        this.logger.info(
          {
            attempt,
            url: page.url(),
            visibleText: bodyText.replace(/\s+/g, " ").trim().slice(0, 260)
          },
          "teams pre-join flow waiting"
        );
      }
      await delay(180);
    }

    throw new Error("Unable to complete Microsoft Teams pre-join flow");
  }

  private async handleNoAudioVideoPrompt(): Promise<boolean> {
    const clicked =
      (await this.clickRoleButton(/continue without audio or video/i, 400).catch(() => false)) ||
      (await this.clickText(/continue without audio or video/i, 400).catch(() => false));

    if (clicked) {
      this.logger.info("teams no-audio-video browser prompt accepted");
      await delay(250);
    }

    return clicked;
  }

  private async selectTeamsAudioMode(): Promise<void> {
    const page = this.getPage();
    const audioModePattern = env.TEAMS_AUDIO_MODE === "none" ? /don['’]?t use audio|do not use audio|without audio/i : /computer audio/i;
    const audioModeRadio = page.getByRole("radio", { name: audioModePattern }).first();

    if (await audioModeRadio.isVisible({ timeout: 700 }).catch(() => false)) {
      const checked = await audioModeRadio.isChecked().catch(() => false);
      if (!checked) await audioModeRadio.click().catch(() => undefined);
      this.logger.info({ audioMode: env.TEAMS_AUDIO_MODE }, "teams pre-join audio mode selected");
      return;
    }

    if (await this.clickText(audioModePattern, 700).catch(() => false)) {
      this.logger.info({ audioMode: env.TEAMS_AUDIO_MODE }, "teams pre-join audio mode selected by text");
    }
  }

  private async dismissTeamsDeviceToasts(): Promise<void> {
    await this.dismissTeamsDevicePermissionUi(3);
  }

  private async dismissTeamsDevicePermissionUi(maxAttempts = 4): Promise<boolean> {
    let dismissed = false;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const result = await this.dismissTeamsDevicePermissionUiOnce();
      if (!result.found) break;
      if (!result.clicked) {
        this.logger.warn({ attempt }, "teams device permission modal/toast found but close control was not clickable");
        break;
      }

      dismissed = true;
      this.logger.info({ attempt }, "teams device permission modal/toast dismissed");
      await delay(300);
    }

    return dismissed;
  }

  private async dismissTeamsDevicePermissionUiOnce(): Promise<{ found: boolean; clicked: boolean }> {
    const closePoint = await this.findTeamsDevicePermissionClosePoint();
    if (closePoint) {
      await this.getPage().mouse.click(closePoint.x, closePoint.y).catch(() => undefined);
      return { found: true, clicked: true };
    }

    return this.getPage()
      .evaluate(() => {
        const permissionText =
          /want to use your camera and mic|camera and mic for the meeting|teams needs permission|no microphone|no camera|microphone was found|camera was found|privacy settings to allow|plug one in|enjoy just listening in/i;
        const closeLabel = /close|dismiss|^x$|^×$/i;

        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const textOf = (element: Element): string => (element.textContent || "").replace(/\s+/g, " ").trim();

        const clickCloseInside = (root: Element): boolean => {
          const rootRect = (root as HTMLElement).getBoundingClientRect();
          if (rootRect.width > 920 || rootRect.height > 760 || rootRect.width < 220 || rootRect.height < 60) return false;

          const buttons = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[];
          const closeButton = buttons.find((button) => {
            if (!visible(button)) return false;
            const buttonRect = button.getBoundingClientRect();
            if (
              buttonRect.right < rootRect.left - 8 ||
              buttonRect.left > rootRect.right + 8 ||
              buttonRect.bottom < rootRect.top - 8 ||
              buttonRect.top > rootRect.bottom + 8
            ) {
              return false;
            }
            const label = [button.getAttribute("aria-label"), button.getAttribute("title"), button.getAttribute("data-tid"), button.textContent]
              .filter(Boolean)
              .join(" ")
              .replace(/\s+/g, " ")
              .trim();
            return closeLabel.test(label) || /^[×x]$/i.test(label);
          });
          if (closeButton) {
            closeButton.click();
            return true;
          }

          const points = [
            { x: rootRect.right - 40, y: rootRect.top + 40 },
            { x: rootRect.right - 24, y: rootRect.top + 24 },
            { x: rootRect.right - 16, y: rootRect.top + 16 }
          ];

          for (const point of points) {
            if (point.x <= rootRect.left || point.y >= rootRect.bottom) continue;
            let target = document.elementFromPoint(point.x, point.y) as HTMLElement | null;
            for (let depth = 0; target && depth < 4; depth += 1, target = target.parentElement) {
              if (!root.contains(target)) continue;
              if (target.matches("button, [role='button'], svg, path, span, div")) {
                target.click();
                return true;
              }
            }
          }

          const topRightButton = buttons
            .filter(visible)
            .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right || a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0];
          if (topRightButton) {
            topRightButton.click();
            return true;
          }

          return false;
        };

        const candidates = Array.from(document.querySelectorAll("[role='dialog'], [role='alertdialog'], [role='status'], [aria-live], [data-tid*='toast' i], div, section")) as HTMLElement[];
        const roots: Element[] = [];
        const priorityButtons = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[];
        for (const button of priorityButtons) {
          if (!visible(button)) continue;
          const label = [button.getAttribute("aria-label"), button.getAttribute("title"), button.getAttribute("data-tid"), button.textContent]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (!closeLabel.test(label)) continue;
          const rect = button.getBoundingClientRect();
          if (rect.width > 80 || rect.height > 80) continue;
          const nearestRoot =
            button.closest("[role='dialog']") ?? button.closest("[role='alertdialog']") ?? button.closest("[data-tid*='toast' i]") ?? button.parentElement;
          if (permissionText.test(textOf(button.parentElement ?? button)) || (nearestRoot ? permissionText.test(textOf(nearestRoot)) : false)) {
            button.click();
            return { found: true, clicked: true };
          }
        }

        for (const candidate of candidates) {
          if (!visible(candidate)) continue;
          const text = textOf(candidate);
          if (!permissionText.test(text)) continue;

          const directRoots = [
            candidate.closest("[role='dialog']"),
            candidate.closest("[role='alertdialog']"),
            candidate.closest("[data-tid*='toast' i]"),
            candidate
          ].filter((root): root is Element => Boolean(root));

          roots.push(...directRoots);

          let parent = candidate.parentElement;
          for (let depth = 0; parent && depth < 8; depth += 1, parent = parent.parentElement) {
            if (!visible(parent)) continue;
            if (!permissionText.test(textOf(parent))) continue;
            roots.push(parent);
          }
        }

        const uniqueRoots = [...new Set(roots)]
          .filter(visible)
          .sort((a, b) => {
            const ar = (a as HTMLElement).getBoundingClientRect();
            const br = (b as HTMLElement).getBoundingClientRect();
            return ar.width * ar.height - br.width * br.height;
          });

        if (uniqueRoots.length === 0) return { found: false, clicked: false };

        for (const root of uniqueRoots) {
          if (clickCloseInside(root)) return { found: true, clicked: true };
        }

        return { found: true, clicked: false };
      })
      .catch(() => ({ found: false, clicked: false }));
  }

  private async findTeamsDevicePermissionClosePoint(): Promise<{ x: number; y: number } | null> {
    return this.getPage()
      .evaluate(() => {
        const permissionText =
          /want to use your camera and mic|camera and mic for the meeting|teams needs permission|no microphone|no camera|microphone was found|camera was found|privacy settings to allow|plug one in|enjoy just listening in/i;

        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const textOf = (element: Element): string => (element.textContent || "").replace(/\s+/g, " ").trim();

        const candidates = Array.from(
          document.querySelectorAll("[role='dialog'], [role='alertdialog'], [role='status'], [aria-live], [data-tid*='toast' i], div, section")
        ) as HTMLElement[];

        const roots: HTMLElement[] = [];
        for (const candidate of candidates) {
          if (!visible(candidate) || !permissionText.test(textOf(candidate))) continue;

          let best: HTMLElement | null = null;
          let parent: HTMLElement | null = candidate;
          for (let depth = 0; parent && depth < 8; depth += 1, parent = parent.parentElement) {
            if (!visible(parent) || !permissionText.test(textOf(parent))) continue;
            const rect = parent.getBoundingClientRect();
            const looksLikeToast = rect.width >= 240 && rect.width <= 720 && rect.height >= 60 && rect.height <= 260;
            const looksLikeTeamsModal = rect.width >= 420 && rect.width <= 920 && rect.height >= 260 && rect.height <= 760;
            if (looksLikeToast || looksLikeTeamsModal) best = parent;
          }

          if (best) roots.push(best);
        }

        const uniqueRoots = [...new Set(roots)].sort((a, b) => {
          const ar = a.getBoundingClientRect();
          const br = b.getBoundingClientRect();
          const aToastScore = ar.height <= 260 ? 0 : 1;
          const bToastScore = br.height <= 260 ? 0 : 1;
          return aToastScore - bToastScore || ar.top - br.top || ar.left - br.left;
        });

        for (const root of uniqueRoots) {
          const rect = root.getBoundingClientRect();
          const points = [
            { x: rect.right - 22, y: rect.top + 22 },
            { x: rect.right - 28, y: rect.top + 22 },
            { x: rect.right - 18, y: rect.top + 18 },
            { x: rect.right - 40, y: rect.top + 40 }
          ];

          for (const point of points) {
            if (point.x <= rect.left || point.x >= rect.right || point.y <= rect.top || point.y >= rect.bottom) continue;
            const target = document.elementFromPoint(point.x, point.y);
            if (target && root.contains(target)) return point;
          }
        }

        return null;
      })
      .catch(() => null);
  }

  private async setTeamsControlOff(
    labels: { offStateLabels: string[]; turnOffLabels: string[] },
    fallbackShortcuts: string[],
    device: "microphone" | "camera"
  ): Promise<void> {
    if (await this.hasVisibleTeamsLabel(labels.offStateLabels)) {
      this.logger.info({ device }, "teams device already off");
      return;
    }

    if (device === "camera" && (await this.stopLocalVideoTracks())) {
      await delay(180);
      if (await this.hasVisibleTeamsLabel(labels.offStateLabels)) {
        this.logger.info({ device }, "teams camera stopped by MediaStream track stop");
        return;
      }
    }

    const clicked = await this.clickTeamsButtonByLabel(labels.turnOffLabels);
    if (clicked) {
      await delay(180);
      if (await this.hasVisibleTeamsLabel(labels.offStateLabels)) {
        this.logger.info({ device }, "teams device turned off by button label");
        return;
      }
    }

    const clickedBySelector = await this.clickTeamsDeviceSelector(device);
    if (clickedBySelector) {
      await delay(180);
      if (await this.hasVisibleTeamsLabel(labels.offStateLabels)) {
        this.logger.info({ device }, "teams device turned off by selector");
        return;
      }
    }

    for (const shortcut of fallbackShortcuts) {
      await this.getPage().keyboard.press(shortcut).catch(() => undefined);
      await delay(180);
      if (await this.hasVisibleTeamsLabel(labels.offStateLabels)) {
        this.logger.info({ device, shortcut }, "teams device turned off by shortcut");
        return;
      }
    }

    this.logger.warn({ device }, "teams device off state could not be verified after all strategies");
  }

  private async stopLocalVideoTracks(): Promise<boolean> {
    return this.getPage()
      .evaluate(() => {
        let stopped = false;
        const mediaElements = Array.from(document.querySelectorAll("video")) as HTMLVideoElement[];
        for (const video of mediaElements) {
          const stream = video.srcObject;
          if (!(stream instanceof MediaStream)) continue;
          for (const track of stream.getVideoTracks()) {
            track.stop();
            stopped = true;
          }
        }
        return stopped;
      })
      .catch(() => false);
  }

  private async hasVisibleTeamsLabel(labels: string[]): Promise<boolean> {
    return this.getPage()
      .evaluate((targetLabels) => {
        const nodes = Array.from(document.querySelectorAll("button, [role='button'], [role^='menuitem'], li, div, span"));
        for (const element of nodes) {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = window.getComputedStyle(node);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
          const label = [node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          if (targetLabels.some((target) => label.includes(target))) return true;
        }
        return false;
      }, labels)
      .catch(() => false);
  }

  private async readTeamsParticipantPanel(): Promise<{ open: boolean; names: string[]; debug?: Record<string, unknown> }> {
    // Strategy 1 (primary): DOM query for participant rows inside the people pane.
    // Robust to the multi-section layout (Presenters / Attendees / Lobby) and to
    // muted-no-video attendees whose tiles never render — neither of which the
    // body.innerText "In this meeting (N)" walker can see. Treats every
    // `[role="treeitem"]` (Teams uses a tree because sub-sections are branches)
    // as a participant and extracts the name from its aria-label, with
    // per-participant control-button aria-labels ("More options for <Name>",
    // "<Name>, Organiser") as a same-pane fallback when treeitems are missing.
    const dom = await this.readTeamsParticipantPanelDom();
    if (dom.open && dom.rawNames.length > 0) {
      const cleaned = dom.rawNames
        .map((name) => cleanTeamsParticipantName(name))
        .filter((name): name is string => Boolean(name));
      if (cleaned.length > 0) {
        return {
          open: true,
          names: [...new Set(cleaned)],
          debug: {
            strategy: "dom_treeitem",
            rawNames: dom.rawNames,
            cleanedCount: cleaned.length,
            ...dom.debug
          }
        };
      }
    }

    // Strategy 2 (fallback): body.innerText parsed for the "In this meeting (N)"
    // section. Kept because the DOM selectors above can break across Teams web
    // redesigns; the text walker has caught participants for the longest.
    const bodyText = await this.getPage().locator("body").innerText({ timeout: 1200 }).catch(() => "");
    const parsed = parseTeamsParticipantPanelText(bodyText);
    if (parsed.open) {
      return {
        ...parsed,
        debug: { ...parsed.debug, domAttempt: dom.debug }
      };
    }

    return {
      open: false,
      names: [],
      debug: {
        strategy: "body_text",
        bodyTextSnippet: bodyText.replace(/\s+/g, " ").trim().slice(0, 500),
        domAttempt: dom.debug
      }
    };
  }

  // Scrape participant rows from the people pane via direct DOM selectors. Returns
  // raw `aria-label` strings (caller is responsible for running cleanTeamsParticipantName
  // — that lets a single cleaner enforce the bot-self-name strip and stopword filter
  // for both this path and the body.innerText fallback).
  private async readTeamsParticipantPanelDom(): Promise<{ open: boolean; rawNames: string[]; debug: Record<string, unknown> }> {
    return this.getPage()
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        // Locate the people pane: a visible right-side container whose
        // aria-label / data-tid mentions people / participants / roster, or
        // which itself contains an `In this meeting (…)` / `Participants` header.
        const paneCandidates = Array.from(document.querySelectorAll(
          'aside, section, div[role="complementary"], div[role="dialog"], [data-tid*="people" i], [data-tid*="roster" i], [data-tid*="participant" i], [aria-label*="participant" i], [aria-label*="people" i]'
        )) as HTMLElement[];

        const peoplePane = paneCandidates.filter(visible).find((node) => {
          const rect = node.getBoundingClientRect();
          if (rect.right < window.innerWidth * 0.4) return false;
          if (rect.width < 220 || rect.height < 200) return false;
          const ariaLabel = (node.getAttribute("aria-label") || "").toLowerCase();
          if (/participant|people|roster/.test(ariaLabel)) return true;
          const innerText = ((node as HTMLElement).innerText || "").toLowerCase();
          return /in this meeting|participants|presenters|attendees|lobby/.test(innerText);
        });

        if (!peoplePane) {
          return {
            open: false,
            rawNames: [],
            debug: {
              strategy: "dom_no_pane",
              candidateCount: paneCandidates.filter(visible).length
            }
          };
        }

        // Per-participant rows. Teams renders each as a `treeitem` (the sub-
        // sections — Presenters, Attendees, Lobby — are tree groups). Catching
        // every treeitem inside the pane is therefore section-agnostic.
        const rawNames = new Set<string>();
        const rowDebug: string[] = [];
        const rows = Array.from(peoplePane.querySelectorAll(
          '[role="treeitem"], [data-tid*="people-list-item" i], [data-tid*="participant-item" i], [data-tid*="roster-item" i]'
        )) as HTMLElement[];
        for (const row of rows) {
          if (!visible(row)) continue;
          // Skip the group/branch nodes themselves — they have aria-expanded
          // and usually no per-person aria-label (e.g. "Presenters (1)").
          if (row.getAttribute("aria-expanded") !== null) continue;
          const label = (row.getAttribute("aria-label") || row.getAttribute("title") || "").trim();
          if (!label) continue;
          // Teams formats the label as "Name, Status, …" — take the prefix.
          const namePart = label.split(",")[0]?.trim();
          if (namePart) {
            rawNames.add(namePart);
            if (rowDebug.length < 12) rowDebug.push(label.slice(0, 100));
          }
        }

        // Same-pane fallback: per-participant control buttons. Their aria-label
        // is "More options for <Name>" / "Mute <Name>" / "<Name>, Organiser".
        // Useful when Teams changes the tree markup but keeps the control
        // buttons, or when group nodes wrap real rows.
        const controlPatterns = [
          /^(?:more options|profile details|open contact card|chat) (?:for|with) (.+?)$/i,
          /^(?:mute|unmute|spotlight|pin|unpin|remove) (.+?)$/i,
          /^(.+?),\s*(?:organi[sz]er|presenter|attendee|external|guest|muted|unmuted|in the lobby|waiting)/i
        ];
        const controlDebug: string[] = [];
        for (const node of Array.from(peoplePane.querySelectorAll("[aria-label]")) as HTMLElement[]) {
          const label = (node.getAttribute("aria-label") || "").trim();
          if (!label) continue;
          for (const re of controlPatterns) {
            const match = label.match(re);
            if (match && match[1]) {
              rawNames.add(match[1].trim());
              if (controlDebug.length < 12) controlDebug.push(label.slice(0, 100));
              break;
            }
          }
        }

        return {
          open: true,
          rawNames: [...rawNames],
          debug: {
            strategy: "dom_treeitem",
            paneAriaLabel: (peoplePane.getAttribute("aria-label") || "").slice(0, 80),
            rowCount: rows.length,
            rowLabels: rowDebug,
            controlMatches: controlDebug
          }
        };
      })
      .catch((error) => ({
        open: false,
        rawNames: [] as string[],
        debug: { strategy: "dom_query_failed", error: String(error).slice(0, 200) }
      }));
  }

  private async revealTeamsMeetingToolbar(): Promise<void> {
    const page = this.getPage();
    await page.bringToFront().catch(() => undefined);
    const viewport = page.viewportSize();
    if (!viewport) return;
    await page.mouse.move(Math.floor(viewport.width / 2), Math.max(1, viewport.height - 40)).catch(() => undefined);
    await delay(250);
    await page.mouse.move(Math.floor(viewport.width / 2), Math.floor(viewport.height / 2)).catch(() => undefined);
    await delay(250);
  }

  private async readTeamsVideoTileNames(): Promise<string[]> {
    const bodyText = await this.getPage().locator("body").innerText({ timeout: 1200 }).catch(() => "");
    return parseTeamsVisibleTileNames(bodyText);
  }

  private async clickTeamsPeopleButtonToOpen(): Promise<{ clicked: boolean; alreadyOpen: boolean; debug?: Record<string, unknown> }> {
    await this.revealTeamsMeetingToolbar();

    const roleClicked = await this.clickRoleButton(/^(show |open |view )?(people|participants|participant list|roster)$/i, 700).catch(() => false);
    if (roleClicked) {
      return { clicked: true, alreadyOpen: false, debug: { strategy: "role_button" } };
    }

    const result = await this.getPage()
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        const peoplePattern = /\b(people|participants?|show participants?|open participants?|view participants?|participant list|roster|calling-participants)\b/i;
        const allButtons = Array.from(document.querySelectorAll("button, [role='button']")) as HTMLElement[];
        const visibleButtons = allButtons.filter(visible);
        const matchingButtons: Array<{ label: string; top: number; left: number; pressed: boolean; expanded: boolean }> = [];

        for (const button of visibleButtons) {
          const label = [
            button.getAttribute("data-tid"),
            button.getAttribute("data-testid"),
            button.getAttribute("aria-label"),
            button.getAttribute("aria-description"),
            button.getAttribute("title"),
            button.textContent,
            button.innerText
          ]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();

          if (!peoplePattern.test(label)) continue;

          const rect = button.getBoundingClientRect();
          const pressed = button.getAttribute("aria-pressed") === "true";
          const expanded = button.getAttribute("aria-expanded") === "true";
          const selected = button.getAttribute("aria-selected") === "true";
          const hasActiveClass = /selected|active|pressed/i.test(
            [button.getAttribute("class"), button.getAttribute("data-is-focusable")].filter(Boolean).join(" ")
          );

          matchingButtons.push({
            label: label.toLowerCase().slice(0, 80),
            top: Math.round(rect.top),
            left: Math.round(rect.left),
            pressed: pressed || selected,
            expanded
          });

          // If already open/pressed, do NOT click
          if (pressed || expanded || selected || hasActiveClass) {
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
            // Dump a sample of all visible button labels for debugging
            allButtonLabels: visibleButtons.slice(0, 30).map((b) => {
              const l = [b.getAttribute("data-tid"), b.getAttribute("data-testid"), b.getAttribute("aria-label"), b.getAttribute("title")]
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

    if (result.alreadyOpen) {
      this.logger.info({ debug: result.debug }, "teams people button already indicates panel is open; skipping click");
      this.panelBelievedOpen = true;
    } else if (result.clicked) {
      this.logger.info({ debug: result.debug }, "teams people button clicked to open participant panel");
    } else {
      this.logger.warn({ debug: result.debug }, "teams people button NOT found on page");
    }

    return result;
  }

  private async clickTeamsPeopleButtonFallback(): Promise<boolean> {
    await this.revealTeamsMeetingToolbar();

    const selectors = [
      'button[data-tid*="participant" i]',
      '[role="button"][data-tid*="participant" i]',
      'button[data-testid*="participant" i]',
      '[role="button"][data-testid*="participant" i]',
      'button[aria-label*="participant" i]',
      '[role="button"][aria-label*="participant" i]',
      'button[aria-label*="people" i]',
      '[role="button"][aria-label*="people" i]',
      'button[data-tid*="roster" i]',
      '[role="button"][data-tid*="roster" i]'
    ];

    for (const selector of selectors) {
      if (await this.clickSelector(selector, 500).catch(() => false)) {
        this.logger.info({ selector }, "teams people panel opened by selector fallback");
        return true;
      }
    }

    return false;
  }

  private async clickTeamsButtonByLabel(labels: string[]): Promise<boolean> {
    return this.getPage()
      .evaluate((targetLabels) => {
        const nodes = Array.from(document.querySelectorAll("button, [role='button']"));
        for (const element of nodes) {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) continue;
          const style = window.getComputedStyle(node);
          if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0") continue;
          const disabled =
            node.getAttribute("aria-disabled") === "true" ||
            node.hasAttribute("disabled") ||
            (node as HTMLButtonElement).disabled === true;
          if (disabled) continue;
          const label = [node.getAttribute("data-tid"), node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .toLowerCase();
          if (targetLabels.some((target) => label.includes(target))) {
            node.click();
            return true;
          }
        }
        return false;
      }, labels)
      .catch(() => false);
  }

  private async clickTeamsDeviceSelector(device: "microphone" | "camera"): Promise<boolean> {
    const selectors =
      device === "microphone"
        ? [
            'button[data-tid*="microphone" i]',
            'button[data-tid*="mic" i]',
            'button[aria-label*="microphone" i]',
            'button[aria-label*="mic" i]',
            '[role="button"][aria-label*="microphone" i]',
            '[role="button"][aria-label*="mic" i]'
          ]
        : [
            'button[data-tid*="camera" i]',
            'button[data-tid*="video" i]',
            'button[aria-label*="camera" i]',
            'button[aria-label*="video" i]',
            '[role="button"][aria-label*="camera" i]',
            '[role="button"][aria-label*="video" i]'
          ];

    for (const selector of selectors) {
      const locator = this.getPage().locator(selector).first();
      if (await locator.isVisible({ timeout: 250 }).catch(() => false)) {
        await locator.click({ timeout: 800 }).catch(async () => {
          await locator.evaluate((element) => (element as HTMLElement).click());
        });
        return true;
      }
    }

    return false;
  }

  private async isTeamsParticipantsPanelOpen(): Promise<boolean> {
    return (await this.readTeamsParticipantPanel()).open;
  }

  private async debugTeamsMeetingDom(): Promise<Record<string, unknown>> {
    return this.getPage()
      .evaluate(() => {
        const visible = (element: Element): boolean => {
          const node = element as HTMLElement;
          const rect = node.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          const style = window.getComputedStyle(node);
          return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
        };

        // Capture all visible buttons with their labels and positions
        const buttons = Array.from(document.querySelectorAll("button, [role='button']"))
          .filter(visible)
          .map((b) => {
            const el = b as HTMLElement;
            const r = el.getBoundingClientRect();
            return {
              label: [el.getAttribute("data-tid"), el.getAttribute("aria-label"), el.getAttribute("title")]
                .filter(Boolean)
                .join(" | ")
                .slice(0, 80) || el.textContent?.trim().slice(0, 40),
              pressed: el.getAttribute("aria-pressed"),
              expanded: el.getAttribute("aria-expanded"),
              pos: `[${Math.round(r.top)},${Math.round(r.left)},${Math.round(r.width)}x${Math.round(r.height)}]`
            };
          });

        // Capture major structural elements on the right side
        const rightElements = Array.from(document.querySelectorAll("aside, section, nav, [role='complementary'], [role='dialog'], [class*='panel' i], [class*='pane' i], [class*='roster' i]"))
          .filter(visible)
          .map((el) => {
            const node = el as HTMLElement;
            const r = node.getBoundingClientRect();
            return {
              tag: node.tagName,
              role: node.getAttribute("role"),
              ariaLabel: node.getAttribute("aria-label")?.slice(0, 60),
              dataTid: node.getAttribute("data-tid")?.slice(0, 60),
              className: node.className?.slice(0, 80),
              rect: `${Math.round(r.width)}x${Math.round(r.height)} @(${Math.round(r.left)},${Math.round(r.top)})`,
              textLen: (node.innerText || "").length
            };
          });

        // Body text snippet
        const bodyText = (document.body.innerText || "").replace(/\s+/g, " ").trim();

        return {
          url: window.location.href,
          viewport: `${window.innerWidth}x${window.innerHeight}`,
          buttonCount: buttons.length,
          buttons: buttons.slice(0, 40),
          rightElements: rightElements.slice(0, 10),
          bodyTextSnippet: bodyText.slice(0, 500)
        };
      })
      .catch((error) => ({ error: String(error).slice(0, 200) }));
  }

  private async inspectTeamsCaptionMenuState(): Promise<{ visible: boolean; disabled: boolean; label: string } | null> {
    return this.getPage()
      .evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("button, [role='menuitem'], [role='button']")) as HTMLElement[];
        for (const node of nodes) {
          const label = [node.getAttribute("aria-label"), node.getAttribute("title"), node.textContent]
            .filter(Boolean)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
          if (!/caption/i.test(label)) continue;
          const rect = node.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0 && window.getComputedStyle(node).display !== "none";
          const disabled =
            node.getAttribute("aria-disabled") === "true" ||
            node.hasAttribute("disabled") ||
            (node as HTMLButtonElement).disabled === true ||
            window.getComputedStyle(node).opacity === "0.5";
          return { visible, disabled, label };
        }
        return null;
      })
      .catch(() => null);
  }
}

function parseTeamsParticipantPanelText(bodyText: string): { open: boolean; names: string[]; debug?: Record<string, unknown> } {
  const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const participantsIndex = lines.findIndex((line) => /^participants$/i.test(line));
  const rosterHeaderMatch = lines
    .map((line, index) => ({ line, index, match: line.match(/^in this meeting(?:\s*\((\d+)\))?$/i) }))
    .find((entry) => entry.match);
  const rosterIndex = rosterHeaderMatch ? rosterHeaderMatch.index : -1;
  const expectedCount = rosterHeaderMatch?.match?.[1] ? Number.parseInt(rosterHeaderMatch.match[1], 10) : undefined;
  const open = participantsIndex >= 0 && rosterIndex > participantsIndex;
  if (!open) {
    return {
      open: false,
      names: [],
      debug: {
        strategy: "body_text",
        lines: lines.slice(0, 30)
      }
    };
  }

  // Cap how far past "In this meeting (N)" we read. Even allowing generous
  // overhead for muted/organiser status rows, the panel almost never needs
  // more than ~3 lines per attendee. This stops the scrape from absorbing
  // the captions stream when the panel is empty or scrolled away.
  const maxRosterLines = expectedCount && expectedCount > 0 ? expectedCount * 3 + 6 : 24;
  const rawRosterLines = lines.slice(rosterIndex + 1, rosterIndex + 1 + maxRosterLines);
  const names: string[] = [];
  let stopReason: string | undefined;

  for (const line of rawRosterLines) {
    if (isTeamsPanelBoundaryLine(line)) {
      stopReason = "boundary_line";
      break;
    }
    if (isLikelyCaptionLine(line)) {
      stopReason = "caption_like_line";
      break;
    }
    if (expectedCount !== undefined && names.length >= expectedCount + 2) {
      stopReason = "expected_count_reached";
      break;
    }
    const name = cleanTeamsParticipantName(line);
    if (name) names.push(name);
  }

  return {
    open: true,
    names: [...new Set(names)],
    debug: {
      strategy: "body_text",
      participantLineIndex: participantsIndex,
      rosterLineIndex: rosterIndex,
      expectedCount,
      stopReason,
      rawRosterSample: rawRosterLines.slice(0, 24),
      rawValueCount: rawRosterLines.length
    }
  };
}

function isLikelyCaptionLine(line: string): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Toolbar / button labels with keyboard shortcuts (e.g. "Leave (Ctrl+Shift+H)",
  // "Mute (Ctrl+Shift+M)") leak in when the panel collapses past the roster.
  if (/\(\s*(ctrl|alt|shift|meta|cmd|⌘|⌥|⇧|⌃)[\s+\-\w⌘⌥⇧⌃↑↓]*\)/i.test(trimmed)) return true;
  if (/\bctrl\s*[+\-]\s*shift\b/i.test(trimmed)) return true;

  // Multiple sentence-punctuation marks are a hard tell.
  if (((trimmed.match(/[.?!]/g) ?? []).length) >= 2) return true;

  // A line ending in . / ? / ! is almost always a caption, not a roster name.
  if (/[.?!]\s*$/.test(trimmed)) return true;

  // Long lines (> 4 tokens) are also caption-shaped; Teams roster rows are short.
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length > 4) return true;

  return false;
}

function parseTeamsVisibleTileNames(bodyText: string): string[] {
  const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const names: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!isLikelyTeamsTileName(line)) continue;
    const next = lines[index + 1] ?? "";
    if (next && !isLikelyTeamsTileStatus(next)) continue;
    const name = cleanTeamsParticipantName(line);
    if (name) names.push(name);
  }

  return [...new Set(names)];
}

function parseTeamsCaptionText(bodyText: string, time: Date): Array<Omit<CaptionTimelineEntry, "source">> {
  const lines = bodyText.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const captions: Array<Omit<CaptionTimelineEntry, "source">> = [];
  const tileNames = parseTeamsVisibleTileNames(bodyText);
  const knownNames = new Set(tileNames.map((name) => name.toLocaleLowerCase("en-US")));
  const participantNameLookup = new Set<string>();
  for (const name of tileNames) {
    participantNameLookup.add(name.toLocaleLowerCase("en-US"));
    for (const token of name.split(/\s+/).filter(Boolean)) {
      participantNameLookup.add(token.toLocaleLowerCase("en-US"));
    }
  }

  for (let index = 0; index < lines.length - 1; index += 1) {
    const speaker = cleanTeamsParticipantName(lines[index]);
    if (!speaker) continue;
    if (knownNames.size > 0 && !knownNames.has(speaker.toLocaleLowerCase("en-US"))) continue;

    const text = lines[index + 1];
    if (!isLikelyTeamsCaptionText(text)) continue;
    if (isParticipantNameLikeText(text, participantNameLookup)) continue;

    captions.push({ speaker, text, time });
    index += 1;
  }

  return captions.slice(-20);
}

function isParticipantNameLikeText(text: string, participantNameLookup: Set<string>): boolean {
  if (!text) return false;
  if (participantNameLookup.size === 0) return false;

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (participantNameLookup.has(normalized.toLocaleLowerCase("en-US"))) return true;

  const tokens = normalized.split(/\s+/);
  if (tokens.length > 3) return false;
  return tokens.every((token) => participantNameLookup.has(token.toLocaleLowerCase("en-US")));
}

function cleanTeamsParticipantName(value: string | null | undefined): string | null {
  if (!value) return null;
  const fromControlLabel = value.match(/\b(?:more options for|profile details for|open contact card for|chat with|mute|unmute|spotlight|pin|unpin|remove)\s+(.+)$/i)?.[1];
  const stripped = (fromControlLabel ?? value)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu, " ")
    .replace(/\b(?:muted|unmuted|organiser|organizer|presenter|external|guest|in this meeting|you|me|more options|profile details|open contact card|chat with|participant|participants)\b/giu, " ")
    .replace(/\bgvoice\s+ai\s+bot\b/giu, " ")
    .replace(/[^\p{L}\p{M}\s.'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped || /\d/.test(stripped)) return null;
  if (/^(participants?|people|share invite|invite|copy meeting link|search for people|in this meeting|close|search|chat|raise|react|view|more|leave|camera|mic|microphone|share|send|manage|gvoice|ai|bot|for|with|and|the)$/i.test(stripped)) {
    return null;
  }
  if (!/\p{L}/u.test(stripped)) return null;
  return stripped;
}

function isTeamsPanelBoundaryLine(line: string): boolean {
  return /^(chat|raise|react|view|more|camera|mic|share|leave|meeting chat|type a new message|send)$/i.test(line);
}

function isLikelyTeamsTileName(line: string): boolean {
  if (!line) return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 60) return false;

  // UI chrome / toolbar / page text we never want.
  if (/^(participants?|people|chat|raise|react|view|more|camera|mic|share|leave|captions?|speaker [a-z]?|rejoin|sign in|learn|meetings?|sign|need help\??)$/i.test(trimmed)) return false;
  if (/^(hello|good morning|okay|done|hmm?|yes|no|hi|bye|ok)$/i.test(trimmed)) return false;

  // Caption-shaped lines have sentence punctuation. Real tile labels don't.
  if (/[.?!,]/.test(trimmed)) return false;

  // Too many words → almost certainly a caption, not a name on a tile.
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  if (tokens.length === 0 || tokens.length > 3) return false;

  // Must be letters/marks only (allow hyphen and apostrophe), no digits.
  if (/\d/.test(trimmed)) return false;
  if (!/\p{L}/u.test(trimmed)) return false;

  return true;
}

function isLikelyTeamsTileStatus(line: string): boolean {
  // Only accept genuine Teams tile-status sentinels. Previously we accepted any
  // name-shaped line, which let the captions stream (e.g. "Mazama." right after
  // a "Rushil Dalbanjan" caption line) masquerade as a status pair.
  return /^(muted|unmuted|organiser|organizer|presenter|external|guest|you|raised hand|speaking|sharing|camera off|camera on|hand raised)$/i.test(line.trim());
}

function isLikelyTeamsCaptionText(line: string): boolean {
  if (!line || line.length < 2 || line.length > 500) return false;
  if (/^(muted|unmuted|organiser|organizer|presenter|external|guest|you)$/i.test(line)) return false;
  if (/^(participants?|people|share invite|invite|copy meeting link|chat|raise|react|view|more|camera|mic|share|leave|captions?|type a new message|send)$/i.test(line)) {
    return false;
  }
  return /\p{L}/u.test(line);
}
