import dotenv from "dotenv";
dotenv.config();
import { connectMongo, disconnectMongo } from "../src/db/mongoose";
import { hydrateRuntimeConfig, cfgString, isOverridden, setRuntimeConfig } from "../src/config/runtimeConfig";

// Sets SARVAM_API_KEY as an encrypted DB override (wins over .env; same path as
// the Settings UI).  npx tsx scripts/set-sarvam-key.ts <newKey>
async function main() {
  const newKey = process.argv[2];
  await connectMongo();
  await hydrateRuntimeConfig();

  const before = cfgString("SARVAM_API_KEY") ?? "";
  const mask = (k: string) => (k ? `${k.slice(0, 6)}…${k.slice(-4)} (len ${k.length})` : "<none>");
  console.log("BEFORE:", mask(before), "| source:", isOverridden("SARVAM_API_KEY") ? "db-override" : "env/default");

  if (!newKey) {
    console.log("(no key argument — report only)");
    await disconnectMongo();
    return;
  }

  await setRuntimeConfig("SARVAM_API_KEY", newKey);
  const after = cfgString("SARVAM_API_KEY") ?? "";
  console.log("AFTER: ", mask(after), "| source:", isOverridden("SARVAM_API_KEY") ? "db-override" : "env/default");
  console.log(after === newKey ? "OK — key updated" : "MISMATCH — update failed");
  await disconnectMongo();
}
main().catch((e) => {
  console.error(e?.message ?? e);
  process.exit(1);
});
