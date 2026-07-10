import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type SignOptions } from "jsonwebtoken";
import type { CookieOptions } from "express";
import { env } from "../config/env";

export interface JwtPayload {
  userId: string;
  email: string;
}

export function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

export function signToken(payload: JwtPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_EXPIRES_IN as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_SECRET, options);
}

export function verifyToken(token: string): JwtPayload {
  const decoded = jwt.verify(token, env.JWT_SECRET);
  if (typeof decoded === "string" || !decoded || typeof decoded !== "object") {
    throw new Error("Invalid token payload");
  }
  const { userId, email } = decoded as Partial<JwtPayload>;
  if (!userId || !email) throw new Error("Token missing required claims");
  return { userId, email };
}

// SameSite=None requires Secure. Browsers treat localhost as a secure context
// so Secure cookies still work in dev. In production this requires HTTPS.
export function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
    domain: env.COOKIE_DOMAIN || undefined
  };
}

export const AUTH_COOKIE_NAME = "token";
export const REFRESH_COOKIE_NAME = "refresh_token";

// Refresh tokens — opaque random strings, never JWTs. Stored server-side as
// sha256 hashes so a DB leak can't be replayed as live tokens.
export function generateRefreshToken(): string {
  return randomBytes(64).toString("hex");
}

export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function refreshTokenExpiry(): Date {
  return new Date(Date.now() + env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
}

// Refresh cookie is path-scoped to /api/auth so the browser only attaches it
// on auth endpoints — every other request still uses the short-lived access
// token. Reduces exposure on the wire.
export function refreshCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "none",
    maxAge: env.REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000,
    path: "/api/auth",
    domain: env.COOKIE_DOMAIN || undefined
  };
}

// CSRF double-submit pattern:
// - Server sets `csrf` cookie alongside `token` cookie. Both share the same
//   lifetime. The csrf cookie is intentionally NOT HttpOnly so the SPA can
//   read it via document.cookie and echo it as X-CSRF-Token on writes.
// - On state-changing requests the server checks the header matches the
//   cookie. A cross-site attacker can ride the user's cookies in a forged
//   POST, but cannot read the cookie value to forge the header — so the
//   double-submit pair fails to match and the request is rejected.
export const CSRF_COOKIE_NAME = "csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function generateCsrfToken(): string {
  return randomBytes(32).toString("hex");
}

export function csrfCookieOptions(): CookieOptions {
  return {
    httpOnly: false, // SPA needs to read it
    secure: true,
    sameSite: "none",
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: "/",
    domain: env.COOKIE_DOMAIN || undefined
  };
}
