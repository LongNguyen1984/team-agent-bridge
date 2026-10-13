#!/usr/bin/env node
// One-time setup:
//  1. creates .env from .env.example (if missing)
//  2. installs the enforced-approval hook for ALL your workspaces: ~/.copilot/hooks/teams-agent-bridge.json
//  3. prints the MCP server block to paste into VS Code ("MCP: Open User Configuration")
//
// Usage: npm run setup            (hook + MCP)
//        npm run setup -- --no-hook (MCP only)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, loadConfig } from "../src/lib.mjs";

const noHook = process.argv.includes("--no-hook");
const uninstall = process.argv.includes("--uninstall");
const node = process.execPath;
const hookDir = path.join(os.homedir(), ".copilot", "hooks");
const hookFile = path.join(hookDir, "teams-agent-bridge.json");

if (uninstall) {
  if (fs.existsSync(hookFile)) fs.rmSync(hookFile);
  console.log(`Removed ${hookFile}. Remove the "teamsBridge" server from your VS Code MCP config manually.`);
  process.exit(0);
}

// 1. .env
const envFile = path.join(ROOT, ".env");
if (!fs.existsSync(envFile)) {
  fs.copyFileSync(path.join(ROOT, ".env.example"), envFile);
  console.log(`✔ Created ${envFile} — open it and paste your flow URLs.`);
} else {
  console.log(`✔ ${envFile} already exists (kept).`);
}
const cfg = loadConfig();

// 2. hook
const hookScript = path.join(ROOT, "hooks", "teams-hook.mjs");
const cmd = `"${node}" "${hookScript}"`;
if (!noHook) {
  const timeout = Math.ceil(cfg.timeoutMinutes * 60 + 60); // seconds; default VS Code timeout is only 30s
  const entry = { type: "command", command: cmd, windows: cmd, timeout };
  const hookJson = { hooks: { PreToolUse: [entry], Stop: [entry] } };
  fs.mkdirSync(hookDir, { recursive: true });
  fs.writeFileSync(hookFile, JSON.stringify(hookJson, null, 2));
  console.log(`✔ Installed hook: ${hookFile} (timeout ${timeout}s)`);
}

// 3. MCP config
const mcp = {
  servers: {
    teamsBridge: { type: "stdio", command: node, args: [path.join(ROOT, "src", "server.mjs")] },
  },
};
fs.mkdirSync(path.join(ROOT, "generated"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "generated", "mcp.json"), JSON.stringify(mcp, null, 2));

console.log(`
Next steps
──────────
1. Connect your phone:
     Telegram (free):  npm run telegram:setup        (docs/SETUP-TELEGRAM.md)
     Teams (Premium):  fill TEAMS_ASK_FLOW_URL in .env (docs/SETUP-POWER-AUTOMATE.md)
2. In VS Code: Ctrl+Shift+P → "MCP: Open User Configuration" and merge this in
   (also saved to generated/mcp.json):

${JSON.stringify(mcp, null, 2)}

3. Test from a terminal:   npm run test:ask
4. Before you leave your desk:   npm run away     (back at desk: npm run back)
5. Copy templates/copilot-instructions.md into your project's .github/ folder
   (or append it to an existing .github/copilot-instructions.md).
`);
