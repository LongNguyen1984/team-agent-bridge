#!/usr/bin/env node
// Toggle "away mode". While away, the hooks route approvals to your phone.
// While at your desk, the hooks do nothing and VS Code behaves normally.
//   npm run away   |   npm run back   |   npm run status
import fs from "node:fs";
import { AWAY_FLAG, STATE_DIR, isAway, loadConfig, notify } from "../src/lib.mjs";

const cmd = process.argv[2] || "status";
const cfg = loadConfig();

if (cmd === "on") {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(AWAY_FLAG, new Date().toISOString());
  console.log(`🟢 Away mode ON — agent approvals and finish prompts will go to your phone (${cfg.channel}).`);
  try {
    const r = await notify({ title: "📱 Away mode ON", message: `Agent control for **${cfg.machineName}** is now on this phone.`, cfg });
    if (r.sent) console.log("   (sent a confirmation to your phone)");
  } catch (e) { console.log(`   (notify failed: ${e.message})`); }
} else if (cmd === "off") {
  if (fs.existsSync(AWAY_FLAG)) fs.rmSync(AWAY_FLAG);
  console.log("⚪ Away mode OFF — hooks are idle, VS Code asks on screen as usual.");
} else {
  console.log(isAway() ? "🟢 Away mode is ON" : "⚪ Away mode is OFF");
  console.log(`   hook enabled: ${cfg.hookEnabled}, require away flag: ${cfg.requireAwayFlag}`);
  console.log(`   gated tools: /${cfg.gateTools}/i, stop hook: ${cfg.stopHook}, timeout: ${cfg.timeoutMinutes} min (${cfg.onTimeout})`);
  console.log(`   channel: ${cfg.channel}`);
  if (cfg.channel === "telegram") console.log(`   telegram token: ${cfg.telegramToken ? "set" : "NOT SET"}, chat id: ${cfg.telegramChatId || "NOT SET"}`);
  else console.log(`   ask flow: ${cfg.askFlowUrl ? "set" : "NOT SET"}, notify webhook: ${cfg.notifyWebhookUrl ? "set" : "not set"}`);
}
