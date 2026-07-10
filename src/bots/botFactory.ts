import type { Logger } from "pino";
import type { BotPlatform } from "../types/meeting";
import type { MeetingBot } from "./types";
import { GoogleMeetBot } from "./googleMeetBot";
import { MicrosoftTeamsBot } from "./microsoftTeamsBot";
import { ZoomBot } from "./zoomBot";

export function createMeetingBot(platform: BotPlatform, logger: Logger): MeetingBot {
  switch (platform) {
    case "google_meet":
      return new GoogleMeetBot(logger);
    case "microsoft_teams":
      return new MicrosoftTeamsBot(logger);
    case "zoom":
      return new ZoomBot(logger);
    default:
      throw new Error(`Unsupported platform: ${platform satisfies never}`);
  }
}
