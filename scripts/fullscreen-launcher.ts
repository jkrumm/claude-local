#!/usr/bin/env bun
/**
 * fullscreen-launcher — opens cqueue.local URLs in Chrome kiosk mode
 *
 * Listens on :7706. Called by the DiagramPanel fullscreen button when the
 * native browser Fullscreen API is unavailable (e.g. CMUX's WebKit).
 *
 * Start:  bun run ~/.claude/fullscreen-launcher.ts
 * Exit kiosk:  Cmd+Q  (Esc does NOT exit Chrome kiosk mode)
 */
import { existsSync } from "fs";

const PORT = 7706;
const ALLOWED_ORIGIN = "http://cqueue.local";

// Chrome binary candidates — tried in order, first existing one wins
const chromeCandidates: string[] = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
];

// Also check for Playwright Chrome for Testing
const playwrightBase = `${process.env.HOME}/Library/Caches/ms-playwright`;
try {
  const glob = new Bun.Glob("chromium-*/chrome-mac/Chromium.app/Contents/MacOS/Chromium");
  for await (const match of glob.scan(playwrightBase)) {
    chromeCandidates.push(`${playwrightBase}/${match}`);
    break;
  }
} catch {
  // Playwright not installed — skip
}

function findChrome(): string | null {
  return chromeCandidates.find((p) => existsSync(p)) ?? null;
}

function openKiosk(url: string) {
  const chrome = findChrome();
  if (!chrome) {
    console.warn("No Chrome binary found — tried:", chromeCandidates);
    return;
  }
  // Isolated user-data-dir so kiosk doesn't interfere with existing Chrome sessions
  Bun.spawn([chrome, "--kiosk", "--user-data-dir=/tmp/cqueue-kiosk", url], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  console.log(`Opened kiosk: ${url}`);
}

const corsHeaders = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

Bun.serve({
  port: PORT,
  fetch(req) {
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(req.url).searchParams.get("url") ?? "";
    if (!url.startsWith(ALLOWED_ORIGIN)) {
      return new Response("Forbidden", { status: 403, headers: corsHeaders });
    }

    openKiosk(url);
    return new Response("ok", { headers: corsHeaders });
  },
});

console.log(`fullscreen-launcher ready on :${PORT} — waiting for requests`);
