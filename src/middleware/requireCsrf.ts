import type { NextFunction, Request, Response } from "express";
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from "../services/authService";

// Methods that don't change server state — exempt from CSRF (browsers won't
// even send a preflight for GET/HEAD/OPTIONS in most cases).
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Double-submit token check. Requires the X-CSRF-Token header to exactly match
// the csrf cookie. Returns 403 on mismatch — a separate code from 401 so the
// SPA can react differently (clear token vs prompt for fresh CSRF).
export function requireCsrf(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME];
  if (
    typeof cookieToken !== "string" ||
    typeof headerToken !== "string" ||
    cookieToken.length === 0 ||
    cookieToken !== headerToken
  ) {
    res.status(403).json({ error: "csrf_invalid" });
    return;
  }
  next();
}
