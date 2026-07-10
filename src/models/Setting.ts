import { Schema, model, type HydratedDocument, type Model, type Types } from "mongoose";

// A runtime-overridable configuration value managed from the Super Admin
// Settings page. Only keys in the runtimeConfig allowlist are ever written here.
// The value is always stored encrypted at rest (AES-256-GCM via tokenCrypto),
// even for non-secret tunables, so the storage path is uniform.
export interface Setting {
  key: string;
  valueEncrypted: string;
  isSecret: boolean;
  updatedBy?: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
}

export type SettingDocument = HydratedDocument<Setting>;
type SettingModelType = Model<Setting>;

const settingSchema = new Schema<Setting, SettingModelType>(
  {
    key: { type: String, required: true, unique: true, index: true },
    valueEncrypted: { type: String, required: true },
    isSecret: { type: Boolean, required: true, default: false },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" }
  },
  { timestamps: true }
);

export const SettingModel = model<Setting, SettingModelType>("Setting", settingSchema);
