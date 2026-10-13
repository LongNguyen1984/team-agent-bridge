#!/usr/bin/env node
// Send a test card to Teams and print the answer.  npm run test:ask  |  npm run test:notify
import { askTeams, notifyTeams, loadConfig } from "../src/lib.mjs";

const cfg = loadConfig();
try {
  if (process.argv.includes("--notify")) {
    const r = await notifyTeams({ title: "🔔 Test notification", message: "teams-agent-bridge can reach you.", cfg });
    console.log(r.sent ? "✔ Notification sent — check Teams." : `✘ Not sent: ${r.reason}`);
  } else {
    console.log(`Posting test card… answer it on your phone (waiting up to ${cfg.timeoutMinutes} min).`);
    const ans = await askTeams({
      title: "🧪 Test from teams-agent-bridge",
      question: "Tap a button. Optionally type something first.",
      details: "$ echo hello",
      options: ["Continue", "Stop"],
      cfg,
    });
    console.log("✔ Answer received:", ans);
  }
} catch (e) {
  console.error("✘", e.message);
  process.exit(1);
}
