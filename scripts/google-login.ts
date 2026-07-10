import path from "node:path";
import dotenv from "dotenv";
import { chromium } from "playwright";

dotenv.config();

async function main(): Promise<void> {
  const userDataDir = path.resolve(process.env.GOOGLE_USER_DATA_DIR || ".data/browser-profiles/google");
  const browser = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1366, height: 768 },
    permissions: ["camera", "microphone"],
    args: [
      "--start-maximized",
      "--use-fake-ui-for-media-stream",
      "--disable-blink-features=AutomationControlled"
    ]
  });

  const page = browser.pages()[0] ?? (await browser.newPage());
  await page.goto("https://accounts.google.com", { waitUntil: "domcontentloaded" });

  console.log(`Google profile directory: ${userDataDir}`);
  console.log("Sign in to the Google account in the opened Chromium window.");
  console.log("After login is complete, press Enter here to close and save the profile.");

  await new Promise<void>((resolve) => process.stdin.once("data", () => resolve()));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
