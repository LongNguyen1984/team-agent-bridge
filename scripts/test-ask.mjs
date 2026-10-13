#!/usr/bin/env node
// Send a test question to your phone (Telegram or Teams) and print the answer.  npm run test:ask  |  npm run test:notify
import { ask, notify, loadConfig } from "../src/lib.mjs";

const cfg = loadConfig();
try {
  if (process.argv.includes("--notify")) {
    const r = await notify({ title: "🔔 Test notification", message: `teams-agent-bridge can reach you via ${cfg.channel}.`, cfg });
    console.log(r.sent ? "✔ Notification sent — check your phone." : `✘ Not sent: ${r.reason}`);
  } else {
    console.log(`[${cfg.channel}] Posting test question… answer it on your phone (waiting up to ${cfg.timeoutMinutes} min).`);
    const ans = await ask({
      title: "🧪 Test from teams-agent-bridge",
      question: cfg.channel === "telegram" ? "Tap a button, or reply to this message with some text." : "Tap a button. Optionally type something first.",
      details: "$ echo hello",
      options: ["Continue", "Stop"],
      textChoice: "Reply",
      cfg,
    });
    console.log("✔ Answer received:", ans);
  }
} catch (e) {
  console.error("✘", e.message);
  process.exit(1);
}
