import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env";
import { CalendarConnectionModel, calendarProviders, type CalendarProvider } from "../models/CalendarConnection";
import { requireAuth } from "../middleware/requireAuth";
import { requireCsrf } from "../middleware/requireCsrf";
import { encryptSecret } from "../utils/tokenCrypto";
import { getUpcomingMeetings } from "../services/calendar/calendarEventsService";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchAccountIdentity,
  getProviderClientId,
  isProviderConfigured,
  signOAuthState,
  verifyOAuthState,
  type AccountIdentity
} from "../services/calendar/calendarOAuthService";
import { logger } from "../utils/logger";

const providerParam = z.enum(calendarProviders);

// Where the OAuth callback sends the browser back to in the SPA.
function appRedirect(status: string, provider: CalendarProvider): string {
  const url = new URL("/settings/calendars", env.WEB_ORIGIN);
  url.searchParams.set("provider", provider);
  url.searchParams.set("status", status);
  return url.toString();
}

export const calendarRouter = Router();

// ── Connection management (authenticated SPA calls) ─────────────────────────

calendarRouter.get("/connections", requireAuth, async (req, res, next) => {
  try {
    const connections = await CalendarConnectionModel.find({ userId: req.user!.id })
      .select("provider accountEmail accountName status lastSyncedAt lastError createdAt updatedAt")
      .lean();
    res.json({
      connections,
      available: {
        google: isProviderConfigured("google"),
        microsoft: isProviderConfigured("microsoft")
      }
    });
  } catch (error) {
    next(error);
  }
});

// Upcoming meetings across the user's connected calendars (what the bot will
// auto-join). On-demand read; refreshes provider tokens as needed.
const eventsQuery = z.object({
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional()
});

// Window is clamped so a client can't request an unbounded calendar scan.
const MAX_WINDOW_DAYS = 62;

calendarRouter.get("/events", requireAuth, async (req, res, next) => {
  try {
    const { from, to } = eventsQuery.parse(req.query);
    let window: { from?: Date; to?: Date } = {};
    if (from && to) {
      const fromDate = new Date(from);
      const cappedTo = new Date(Math.min(new Date(to).getTime(), fromDate.getTime() + MAX_WINDOW_DAYS * 86400_000));
      window = { from: fromDate, to: cappedTo };
    }
    const result = await getUpcomingMeetings(req.user!.id, window);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Returns the provider authorize URL for the SPA to navigate to. GET (no CSRF);
// auth identifies which user is connecting, encoded into a signed state.
calendarRouter.get("/:provider/start", requireAuth, async (req, res, next) => {
  try {
    const provider = providerParam.parse(req.params.provider);
    if (!isProviderConfigured(provider)) {
      res.status(503).json({ error: "provider_not_configured" });
      return;
    }
    const state = signOAuthState(req.user!.id, provider);
    res.json({ url: buildAuthorizeUrl(provider, state) });
  } catch (error) {
    next(error);
  }
});

// OAuth redirect target. NO requireAuth — the signed `state` carries the user.
// Always redirects the browser back into the SPA (success or failure).
calendarRouter.get("/:provider/callback", async (req, res) => {
  let provider: CalendarProvider | undefined;
  try {
    provider = providerParam.parse(req.params.provider);
    const query = z.object({ code: z.string().min(1), state: z.string().min(1) }).safeParse(req.query);
    if (!query.success) {
      logger.warn({ provider, query: req.query }, "calendar oauth callback missing code/state");
      res.redirect(appRedirect("error", provider));
      return;
    }

    const { userId } = verifyOAuthState(query.data.state, provider);
    const tokens = await exchangeCodeForTokens(provider, query.data.code);
    if (!tokens.refreshToken) {
      // Without a refresh token we can't sync later. Force a clean re-consent.
      logger.warn({ provider, userId }, "calendar oauth returned no refresh token");
      res.redirect(appRedirect("no_refresh_token", provider));
      return;
    }

    const identity: AccountIdentity = await fetchAccountIdentity(provider, tokens.accessToken).catch(() => ({}));

    await CalendarConnectionModel.findOneAndUpdate(
      { userId, provider },
      {
        $set: {
          refreshTokenEncrypted: encryptSecret(tokens.refreshToken),
          accessToken: tokens.accessToken,
          accessTokenExpiresAt: tokens.expiresAt,
          scopes: tokens.scopes,
          accountEmail: identity.email,
          accountName: identity.name,
          oauthClientId: getProviderClientId(provider),
          status: "connected",
          lastError: undefined
        },
        // Reconnecting should restart incremental sync from scratch.
        $unset: { syncToken: "", deltaLink: "" }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    logger.info({ provider, userId, accountEmail: identity.email }, "calendar connected");
    res.redirect(appRedirect("connected", provider));
  } catch (error) {
    logger.error({ err: error, provider }, "calendar oauth callback failed");
    res.redirect(appRedirect("error", provider ?? "google"));
  }
});

calendarRouter.delete("/connections/:provider", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const provider = providerParam.parse(req.params.provider);
    await CalendarConnectionModel.deleteOne({ userId: req.user!.id, provider });
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
