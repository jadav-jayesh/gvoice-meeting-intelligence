import dotenv from "dotenv";

dotenv.config();

import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { UserModel } from "../src/models/User";

// Bootstrap the first Super Admin. No admin exists at launch, and the only
// in-app way to grant admin is via an existing admin — so seed one here, once,
// directly against the DB. After this, promote/demote others from the dashboard.
//
// Idempotent: re-running on an already-admin user is a no-op.
//
//   npx tsx scripts/seed-admin.ts admin@example.com      # promote by arg
//   SEED_ADMIN_EMAIL=admin@example.com npx tsx scripts/seed-admin.ts
async function main(): Promise<void> {
  const email = (process.argv[2] || process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
  if (!email) {
    console.error("Usage: npx tsx scripts/seed-admin.ts <email>   (or set SEED_ADMIN_EMAIL)");
    process.exitCode = 1;
    return;
  }

  await connectMongo();
  try {
    const user = await UserModel.findOne({ email });
    if (!user) {
      console.error(`No user found with email ${email}. They must sign up first, then re-run this.`);
      process.exitCode = 1;
      return;
    }
    if (user.role === "admin") {
      console.log(`${email} is already an admin — nothing to do.`);
      return;
    }
    user.role = "admin";
    await user.save();
    console.log(`Promoted ${email} to admin.`);
  } finally {
    await disconnectMongo();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
