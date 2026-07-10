import type { NextFunction, Request, Response } from "express";
import { UserModel } from "../models/User";

// Gate for the Super Admin surface (/api/admin). MUST run AFTER requireAuth,
// which populates req.user from the JWT.
//
// The role is read from the DB on every call rather than trusted from the JWT:
// the access token lives for days, so an admin who is demoted would otherwise
// keep admin access until their token expired. A per-request lookup makes
// promote/demote take effect immediately. Admin endpoints are low-volume, so
// the extra read is negligible.
export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (!req.user) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  try {
    const user = await UserModel.findById(req.user.id).select("role");
    if (!user) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    if (user.role !== "admin") {
      res.status(403).json({ error: "forbidden" });
      return;
    }
    req.user.role = user.role;
    next();
  } catch (error) {
    next(error);
  }
}
