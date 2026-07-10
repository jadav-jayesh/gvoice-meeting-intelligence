import type { NextFunction, Request, Response } from "express";
import { AUTH_COOKIE_NAME, verifyToken } from "../services/authService";

function extractToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[AUTH_COOKIE_NAME];
  if (typeof cookieToken === "string" && cookieToken.length > 0) return cookieToken;
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice("Bearer ".length).trim();
  return undefined;
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const payload = verifyToken(token);
    req.user = { id: payload.userId, email: payload.email };
    next();
  } catch {
    res.status(401).json({ error: "unauthorized" });
  }
}
