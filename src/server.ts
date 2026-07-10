import path from "node:path";
import { existsSync } from "node:fs";
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import pinoHttp from "pino-http";
import { ZodError } from "zod";
import { env } from "./config/env";
import { authRouter } from "./routes/auth";
import { botsRouter } from "./routes/bots";
import { calendarRouter } from "./routes/calendar";
import { meetingsRouter } from "./routes/meetings";
import { insightsRouter } from "./routes/insights";
import { adminRouter } from "./routes/admin";
import { adminSettingsRouter } from "./routes/adminSettings";
import { logger } from "./utils/logger";

export function createServer(): express.Express {
  const app = express();

  // Trust the first proxy hop in production so req.ip reflects the real
  // client (X-Forwarded-For from your load balancer / nginx) instead of the
  // proxy. Without this, express-rate-limit buckets every request into a
  // single key and the limiter becomes a global throttle. Bump the count if
  // you have multiple proxy layers.
  if (env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  // Security headers (XSS, clickjacking, MIME-sniffing, HSTS, etc.).
  // CSP allowlists:
  //   - 'self' for our own bundle + same-origin API calls
  //   - 'unsafe-inline' on style-src for inline style="…" attributes used by
  //     dynamic components (Avatar gradients, animated transforms). Tightening
  //     this would require switching to CSS classes or nonces.
  //   - https: on img/media/connect for Azure Blob recordings/thumbnails that
  //     are signed at runtime with SAS tokens (host varies per storage account).
  //   - frame-ancestors 'none' blocks clickjacking by disallowing the SPA from
  //     being embedded in any other page.
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          ...helmet.contentSecurityPolicy.getDefaultDirectives(),
          "img-src": ["'self'", "data:", "https:"],
          "connect-src": ["'self'", "https:"],
          "media-src": ["'self'", "https:"],
          // The sample/meeting report is rendered into a same-origin blob:
          // iframe (URL.createObjectURL). Without this it falls back to
          // default-src 'self', which blocks blob: and shows the browser's
          // "content is blocked" page.
          "frame-src": ["'self'", "blob:"],
          "child-src": ["'self'", "blob:"],
          "frame-ancestors": ["'none'"]
        }
      },
      // The SPA fetches Azure blob URLs from same-origin code; leaving COEP
      // off avoids forcing every embedded resource to opt-in via CORP headers
      // we don't control.
      crossOriginEmbedderPolicy: false
    })
  );

  app.use(
    cors({
      origin: env.WEB_ORIGIN,
      credentials: true
    })
  );
  app.use(express.json({ limit: "2mb" }));
  app.use(cookieParser());
  app.use(
    pinoHttp({
      logger
    })
  );

  app.get("/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.use("/api/auth", authRouter);
  app.use("/bots", botsRouter);
  app.use("/api/calendar", calendarRouter);
  app.use("/api/meetings", meetingsRouter);
  app.use("/api/insights", insightsRouter);
  app.use("/api/admin/settings", adminSettingsRouter);
  app.use("/api/admin", adminRouter);

  // Serve the Vite-built frontend (web/dist) when present. Skipped in dev —
  // run `npm run dev` in web/ and hit the Vite dev server directly while
  // iterating. In production, `npm run build` in web/ emits the static assets
  // that this block picks up.
  const webDist = path.resolve(process.cwd(), "web", "dist");
  if (existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get(/^\/(?!api|bots|health).*/, (_req, res) => {
      res.sendFile(path.join(webDist, "index.html"));
    });
  }

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ZodError) {
      res.status(400).json({
        error: "Invalid request payload",
        details: error.issues
      });
      return;
    }

    logger.error({ err: error }, "request failed");
    res.status(500).json({
      error: error instanceof Error ? error.message : "Internal server error"
    });
  });

  return app;
}
