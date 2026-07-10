import { Schema, model, Types, type HydratedDocument } from "mongoose";

export interface RefreshToken {
  userId: Types.ObjectId;
  // sha256 hex of the raw token — never store the token itself, otherwise a
  // DB leak hands every active session to an attacker.
  tokenHash: string;
  expiresAt: Date;
  revokedAt?: Date;
  // When a refresh rotates, the new token's id goes here so we can trace
  // chains. If a revoked token is replayed, walk the chain to revoke all
  // descendants — the whole branch is considered compromised.
  replacedBy?: Types.ObjectId;
  // Captured at issue time. Useful for the future "active sessions" UI.
  userAgent?: string;
  ip?: string;
}

export type RefreshTokenDocument = HydratedDocument<RefreshToken>;

const refreshTokenSchema = new Schema<RefreshToken>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    revokedAt: { type: Date },
    replacedBy: { type: Schema.Types.ObjectId, ref: "RefreshToken" },
    userAgent: { type: String },
    ip: { type: String }
  },
  { timestamps: true }
);

// TTL: Mongo auto-deletes expired refresh tokens. Server-side enforcement is
// still in code (we check expiresAt in the refresh handler) — this is just
// housekeeping.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshTokenModel = model<RefreshToken>("RefreshToken", refreshTokenSchema);
