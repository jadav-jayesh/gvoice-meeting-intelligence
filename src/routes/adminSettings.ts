import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/requireAuth";
import { requireAdmin } from "../middleware/requireAdmin";
import { requireCsrf } from "../middleware/requireCsrf";
import { UserModel } from "../models/User";
import {
  describeSettings,
  getSettingDef,
  setRuntimeConfig,
  clearRuntimeConfig
} from "../config/runtimeConfig";
import { isSettingTestable, runSettingTest } from "../config/settingTesters";
import { logger } from "../utils/logger";

export const adminSettingsRouter = Router();

// Same gate as the rest of /api/admin.
adminSettingsRouter.use(requireAuth, requireAdmin);

// GET /api/admin/settings — masked snapshot of all managed keys.
adminSettingsRouter.get("/", (_req, res) => {
  res.json({ settings: describeSettings() });
});

const updateSchema = z.object({
  value: z.string().min(1).max(4000),
  password: z.string().optional()
});

// Validate the submitted value against the key's declared type.
function validateValue(
  def: NonNullable<ReturnType<typeof getSettingDef>>,
  value: string
): string | null {
  if (def.type === "number") {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return "Value must be a non-negative number";
  }
  if (def.type === "enum" && def.options && !def.options.includes(value)) {
    return `Value must be one of: ${def.options.join(", ")}`;
  }
  return null;
}

// PUT /api/admin/settings/:key — set/override a managed key.
adminSettingsRouter.put("/:key", requireCsrf, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const def = getSettingDef(key);
    if (!def) {
      res.status(404).json({ error: "unknown or non-managed setting" });
      return;
    }

    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "value is required" });
      return;
    }
    const value = def.type === "string" ? parsed.data.value : parsed.data.value.trim();

    const invalid = validateValue(def, value);
    if (invalid) {
      res.status(400).json({ error: invalid });
      return;
    }

    // Changing a secret requires re-entering the admin's password — a small
    // barrier against a hijacked session silently swapping provider keys.
    if (def.isSecret) {
      const password = parsed.data.password ?? "";
      const user = await UserModel.findById(req.user!.id);
      if (!user || !(await user.comparePassword(password))) {
        res.status(401).json({ error: "password confirmation failed" });
        return;
      }
    }

    await setRuntimeConfig(key, value, req.user!.id);
    logger.info({ actorId: req.user!.id, key, isSecret: def.isSecret }, "admin updated setting");

    res.json({ settings: describeSettings() });
  } catch (error) {
    next(error);
  }
});

const testSchema = z.object({ value: z.string().min(1).max(4000).optional() });

// POST /api/admin/settings/:key/test — live provider check WITHOUT saving.
// Tests the supplied candidate value, or the currently-resolved one if omitted.
adminSettingsRouter.post("/:key/test", requireCsrf, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const def = getSettingDef(key);
    if (!def) {
      res.status(404).json({ error: "unknown or non-managed setting" });
      return;
    }
    if (!isSettingTestable(key)) {
      res.status(400).json({ error: "no connection test for this setting" });
      return;
    }
    const parsed = testSchema.safeParse(req.body ?? {});
    const candidate = parsed.success ? parsed.data.value : undefined;
    const result = await runSettingTest(key, candidate);
    logger.info({ actorId: req.user!.id, key, ok: result.ok }, "admin tested setting connection");
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// DELETE /api/admin/settings/:key — remove the override, reverting to env.
adminSettingsRouter.delete("/:key", requireCsrf, async (req, res, next) => {
  try {
    const key = String(req.params.key);
    const def = getSettingDef(key);
    if (!def) {
      res.status(404).json({ error: "unknown or non-managed setting" });
      return;
    }
    await clearRuntimeConfig(key);
    logger.info({ actorId: req.user!.id, key }, "admin reverted setting to default");
    res.json({ settings: describeSettings() });
  } catch (error) {
    next(error);
  }
});
