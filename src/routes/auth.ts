import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { UserModel, type UserDocument } from "../models/User";
import { BotSessionModel } from "../models/BotSession";
import { RefreshTokenModel } from "../models/RefreshToken";
import { requireAuth } from "../middleware/requireAuth";
import { requireCsrf } from "../middleware/requireCsrf";
import { deleteAccountData } from "../services/account/dataDeletion";
import {
  AUTH_COOKIE_NAME,
  CSRF_COOKIE_NAME,
  REFRESH_COOKIE_NAME,
  cookieOptions,
  csrfCookieOptions,
  generateCsrfToken,
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  refreshCookieOptions,
  refreshTokenExpiry,
  signToken
} from "../services/authService";
import { logger } from "../utils/logger";

// Mirror of the client-side rule so the server stays the source of truth:
// 8+ chars, at least one upper, one lower, one digit, one special. Keep this
// regex in sync with web/src/auth/useField.ts → strongPassword().
const strongPassword = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password is too long")
  .refine((v) => /[A-Z]/.test(v), "Password must include an uppercase letter")
  .refine((v) => /[a-z]/.test(v), "Password must include a lowercase letter")
  .refine((v) => /\d/.test(v), "Password must include a number")
  .refine(
    (v) => /[!@#$%^&*()\-_=+[\]{};:'",.<>/?\\|`~]/.test(v),
    "Password must include a special character"
  );

const signupSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: strongPassword
});

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(128)
});

const updateMeSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional()
});

// Account deletion requires re-entering the password — irreversible action.
const deleteMeSchema = z.object({
  password: z.string().min(1).max(128)
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(128),
    newPassword: strongPassword
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    message: "New password must differ from current password",
    path: ["newPassword"]
  });

function publicUser(doc: UserDocument) {
  return {
    id: doc.id,
    email: doc.email,
    firstName: doc.firstName,
    lastName: doc.lastName,
    role: doc.role
  };
}

// Mint a full new session: access JWT cookie, CSRF cookie, AND a freshly
// generated refresh token persisted in the DB (hashed). Used by signup, login,
// and as the second half of /refresh after a rotation.
async function issueSession(
  req: import("express").Request,
  res: import("express").Response,
  user: UserDocument,
  replacedBy?: { tokenId: import("mongoose").Types.ObjectId }
): Promise<void> {
  // Access token + CSRF — same as before, just short-lived.
  const accessToken = signToken({ userId: user.id, email: user.email });
  res.cookie(AUTH_COOKIE_NAME, accessToken, cookieOptions());
  res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());

  // Refresh token — store the hash, set the raw value as a cookie.
  const rawRefresh = generateRefreshToken();
  const created = await RefreshTokenModel.create({
    userId: user._id,
    tokenHash: hashRefreshToken(rawRefresh),
    expiresAt: refreshTokenExpiry(),
    userAgent: req.headers["user-agent"]?.slice(0, 256),
    ip: req.ip
  });

  // If this issuance is a rotation, link the old → new for traceability.
  if (replacedBy) {
    await RefreshTokenModel.findByIdAndUpdate(replacedBy.tokenId, {
      $set: { replacedBy: created._id }
    });
  }

  res.cookie(REFRESH_COOKIE_NAME, rawRefresh, refreshCookieOptions());

  // Record last activity for admin analytics. Fire-and-forget, separate from the
  // loaded doc so it can't interfere with the response; failure must not break
  // the login.
  await UserModel.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } }).catch(() => undefined);
}

// Revoke every refresh token in a rotation chain. Used when we detect that a
// revoked token was replayed — assume the chain is compromised and force a
// re-login on every device.
async function revokeChain(rootId: import("mongoose").Types.ObjectId): Promise<void> {
  // Walk the chain forward via replacedBy pointers.
  let cursor: import("mongoose").Types.ObjectId | undefined = rootId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor.toString())) {
    seen.add(cursor.toString());
    const doc = await RefreshTokenModel.findByIdAndUpdate(
      cursor,
      { $set: { revokedAt: new Date() } },
      { new: false }
    );
    cursor = doc?.replacedBy as import("mongoose").Types.ObjectId | undefined;
  }
}

// Rate limiters keyed by IP. Defends against credential-stuffing and brute
// force. Counts toward the limit on every request, including successful ones —
// a legitimate user simply shouldn't be logging in 10 times in 15 minutes.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_attempts" }
});

const signupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_attempts" }
});

const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_attempts" }
});

export const authRouter = Router();

authRouter.post("/signup", signupLimiter, async (req, res, next) => {
  try {
    const payload = signupSchema.parse(req.body);
    const existing = await UserModel.findOne({ email: payload.email }).lean();
    if (existing) {
      res.status(409).json({ error: "email_already_registered" });
      return;
    }

    // First user in the system: claim any pre-existing meetings with no owner.
    // Done before user.save() so a partial state doesn't strand legacy data.
    const userCount = await UserModel.estimatedDocumentCount();

    const passwordHash = await hashPassword(payload.password);
    const user = await UserModel.create({
      email: payload.email,
      passwordHash,
      firstName: payload.firstName,
      lastName: payload.lastName
    });

    if (userCount === 0) {
      const result = await BotSessionModel.updateMany(
        { userId: { $exists: false } },
        { $set: { userId: user._id }, $addToSet: { accessUserIds: user._id } }
      );
      logger.info(
        { userId: user.id, claimed: result.modifiedCount },
        "bootstrap user claimed legacy meetings"
      );
    }

    await issueSession(req, res, user);
    res.status(201).json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const payload = loginSchema.parse(req.body);
    const user = await UserModel.findOne({ email: payload.email });
    if (!user) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    const ok = await user.comparePassword(payload.password);
    if (!ok) {
      res.status(401).json({ error: "invalid_credentials" });
      return;
    }
    await issueSession(req, res, user);
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/logout", requireCsrf, async (req, res, next) => {
  try {
    // Revoke the refresh token tied to THIS cookie (one device). Other devices
    // keep their own refresh tokens and stay signed in.
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof raw === "string" && raw.length > 0) {
      await RefreshTokenModel.findOneAndUpdate(
        { tokenHash: hashRefreshToken(raw), revokedAt: { $exists: false } },
        { $set: { revokedAt: new Date() } }
      );
    }
    res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
    res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions());
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Silent re-auth. SPA calls this when an API request returns 401 — we
// validate + rotate the refresh token and issue a fresh access cookie.
// Rotation: every refresh creates a NEW refresh token and revokes the old.
// Reuse detection: if a previously-revoked token is presented, assume the
// chain is compromised and revoke every descendant + force re-login.
authRouter.post("/refresh", async (req, res, next) => {
  try {
    const raw = req.cookies?.[REFRESH_COOKIE_NAME];
    if (typeof raw !== "string" || raw.length === 0) {
      res.status(401).json({ error: "no_refresh_token" });
      return;
    }

    const record = await RefreshTokenModel.findOne({ tokenHash: hashRefreshToken(raw) });

    if (!record) {
      // Either tampered or already deleted. Treat as invalid.
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      res.status(401).json({ error: "invalid_refresh_token" });
      return;
    }

    // REUSE DETECTION: the token presented is already revoked. Either:
    //  a) the legitimate user is racing two refresh calls (we already rotated)
    //  b) an attacker stole a refresh token and used it after the real user
    // We can't distinguish a from b, so be conservative: revoke the entire
    // rotation chain (everyone signed out) and refuse the call.
    if (record.revokedAt) {
      logger.warn(
        { userId: record.userId.toString() },
        "refresh token reuse detected — revoking chain"
      );
      await revokeChain(record._id);
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      res.status(401).json({ error: "refresh_token_reused" });
      return;
    }

    if (record.expiresAt.getTime() < Date.now()) {
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      res.status(401).json({ error: "refresh_token_expired" });
      return;
    }

    const user = await UserModel.findById(record.userId);
    if (!user) {
      res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
      res.status(401).json({ error: "user_not_found" });
      return;
    }

    // Mark this token revoked + mint a new pair. issueSession links the chain
    // via replacedBy so reuse detection above can walk it.
    record.revokedAt = new Date();
    await record.save();
    await issueSession(req, res, user, { tokenId: record._id });

    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

authRouter.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await UserModel.findById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    // Re-mint the CSRF cookie on every /me call so a cold SPA load (auth
    // cookie still valid, csrf cookie missing or stale) always recovers
    // without an extra round-trip.
    res.cookie(CSRF_COOKIE_NAME, generateCsrfToken(), csrfCookieOptions());
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.patch("/me", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = updateMeSchema.parse(req.body);
    const user = await UserModel.findByIdAndUpdate(
      req.user!.id,
      { $set: payload },
      { new: true, runValidators: true }
    );
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    res.json({ user: publicUser(user) });
  } catch (error) {
    next(error);
  }
});

authRouter.post("/change-password", changePasswordLimiter, requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const payload = changePasswordSchema.parse(req.body);
    const user = await UserModel.findById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const ok = await user.comparePassword(payload.currentPassword);
    if (!ok) {
      res.status(400).json({ error: "current_password_incorrect" });
      return;
    }
    user.passwordHash = await hashPassword(payload.newPassword);
    await user.save();
    // Re-issue cookie so the existing session continues seamlessly with a
    // fresh expiry. (Token contents don't change — userId/email are the same.)
    await issueSession(req, res, user);
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

// Permanently delete the account and all associated data (right to erasure).
// Requires the current password as confirmation. Clears all auth cookies so
// the now-deleted session can't linger client-side.
authRouter.delete("/me", requireAuth, requireCsrf, async (req, res, next) => {
  try {
    const { password } = deleteMeSchema.parse(req.body);
    const user = await UserModel.findById(req.user!.id);
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    const ok = await user.comparePassword(password);
    if (!ok) {
      res.status(400).json({ error: "current_password_incorrect" });
      return;
    }

    await deleteAccountData(req.user!.id);

    res.clearCookie(AUTH_COOKIE_NAME, cookieOptions());
    res.clearCookie(CSRF_COOKIE_NAME, csrfCookieOptions());
    res.clearCookie(REFRESH_COOKIE_NAME, refreshCookieOptions());
    res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});
