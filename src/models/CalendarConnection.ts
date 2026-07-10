import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

// A single user's connection to one calendar provider, created when they click
// "Connect Google/Microsoft Calendar" and complete OAuth. We persist the
// long-lived refresh token (ENCRYPTED — see tokenCrypto) and a cached access
// token; the sync poller uses these to read the user's upcoming events.
//
// A user may have at most one ACTIVE connection per provider (enforced by the
// unique index below), but can connect both Google and Microsoft.

export const calendarProviders = ["google", "microsoft"] as const;
export type CalendarProvider = (typeof calendarProviders)[number];

export const calendarConnectionStatuses = ["connected", "revoked", "error"] as const;
export type CalendarConnectionStatus = (typeof calendarConnectionStatuses)[number];

export interface CalendarConnection {
  userId: Types.ObjectId;
  provider: CalendarProvider;
  // The calendar account the user authorized (their Google/Microsoft email),
  // for display — distinct from the app login email.
  accountEmail?: string;
  accountName?: string;
  // OAuth secrets. refreshToken is stored via encryptSecret(); accessToken is a
  // short-lived cache refreshed on demand.
  refreshTokenEncrypted: string;
  accessToken?: string;
  accessTokenExpiresAt?: Date;
  scopes: string[];
  // The OAuth client_id that issued these tokens. Refresh tokens are bound to
  // the issuing app, so refresh must use the same client. Lets a dedicated
  // calendar app (which also accepts personal Microsoft accounts) run alongside
  // legacy connections issued by the Teams Graph app. Undefined on rows created
  // before this field existed → treated as the Teams Graph app.
  oauthClientId?: string;
  // Incremental-sync cursors so each poll only fetches changes. Google returns
  // a syncToken; Microsoft Graph returns a deltaLink.
  syncToken?: string;
  deltaLink?: string;
  status: CalendarConnectionStatus;
  lastSyncedAt?: Date;
  lastError?: string;
}

export type CalendarConnectionDocument = HydratedDocument<CalendarConnection>;
type CalendarConnectionModelType = Model<CalendarConnection>;

const calendarConnectionSchema = new Schema<CalendarConnection, CalendarConnectionModelType>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    provider: { type: String, enum: calendarProviders, required: true },
    accountEmail: { type: String, trim: true, lowercase: true },
    accountName: { type: String, trim: true },
    refreshTokenEncrypted: { type: String, required: true },
    accessToken: { type: String },
    accessTokenExpiresAt: { type: Date },
    scopes: { type: [String], default: [] },
    oauthClientId: { type: String },
    syncToken: { type: String },
    deltaLink: { type: String },
    status: { type: String, enum: calendarConnectionStatuses, required: true, default: "connected", index: true },
    lastSyncedAt: { type: Date },
    lastError: { type: String }
  },
  { timestamps: true }
);

// One active connection per (user, provider). Reconnecting upserts this doc.
calendarConnectionSchema.index({ userId: 1, provider: 1 }, { unique: true });

export const CalendarConnectionModel = model<CalendarConnection, CalendarConnectionModelType>(
  "CalendarConnection",
  calendarConnectionSchema
);
