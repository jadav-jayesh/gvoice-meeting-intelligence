import { Schema, model, type HydratedDocument, type Model } from "mongoose";
import bcrypt from "bcryptjs";

export const userRoles = ["user", "admin"] as const;
export type UserRole = (typeof userRoles)[number];

export interface User {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  // Access tier. "admin" unlocks the Super Admin dashboard (/admin) and the
  // /api/admin routes. Granted via scripts/seed-admin.ts (first admin) then
  // promoted in-app by an existing admin. Defaults to "user" for every signup.
  role: UserRole;
  // Stamped on every session issuance (login/signup/refresh) so the admin
  // analytics can report login-based active users. Absent until the user's
  // first login after this field shipped.
  lastLoginAt?: Date;
  // Populated by Mongoose `timestamps: true`.
  createdAt?: Date;
  updatedAt?: Date;
}

export interface UserMethods {
  comparePassword(candidate: string): Promise<boolean>;
}

export type UserDocument = HydratedDocument<User, UserMethods>;

type UserModelType = Model<User, Record<string, never>, UserMethods>;

const userSchema = new Schema<User, UserModelType, UserMethods>(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      index: true,
      lowercase: true,
      trim: true
    },
    passwordHash: { type: String, required: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    role: { type: String, enum: userRoles, required: true, default: "user", index: true },
    lastLoginAt: { type: Date, index: true }
  },
  { timestamps: true }
);

// Admin Users list sorts by these fields. Cosmos DB's Mongo API refuses an
// order-by on a path that isn't in an index ("the index path ... is excluded"),
// so each sortable field needs an index. (email already has a field-level index
// via `index: true`.) NOTE: autoIndex is OFF in production (see db/mongoose.ts),
// so these are created manually against Cosmos — adding them here keeps
// local/dev correct and documents what prod must have.
userSchema.index({ createdAt: -1 });
userSchema.index({ firstName: 1, lastName: 1 });

userSchema.methods.comparePassword = function (candidate: string): Promise<boolean> {
  return bcrypt.compare(candidate, this.passwordHash);
};

export const UserModel = model<User, UserModelType>("User", userSchema);
