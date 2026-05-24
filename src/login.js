import { chromium } from "playwright";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";

const profileDir = path.resolve(process.argv[2] || ".browser-profile");
const startUrl = "https://www.bhaskar.com/epaper/";

const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  acceptDownloads: true,
  viewport: { width: 1440, height: 1000 }
});

const page = context.pages()[0] || await context.newPage();
await page.goto(startUrl, { waitUntil: "domcontentloaded" });

console.log(`Browser profile: ${profileDir}`);
console.log("Log in to Dainik Bhaskar in the opened browser.");
console.log("After login is complete, press Enter here to save the session and close.");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
await rl.question("");
rl.close();

await context.close();
