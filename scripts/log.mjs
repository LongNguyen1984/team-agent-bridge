#!/usr/bin/env node
// Show the last hook decisions:  npm run log   (npm run log -- 50  for more lines)
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR } from "../src/lib.mjs";

const file = path.join(STATE_DIR, "hook.log");
const n = Number(process.argv[2]) || 20;
if (!fs.existsSync(file)) {
  console.log("No hook activity yet. If the agent already ran tools, VS Code is not running the hook:");
  console.log("  • Run `npm run setup` again, then in VS Code: Ctrl+Shift+P → Chat: Configure Hooks — is teams-agent-bridge.json listed?");
  console.log("  • Is the chat session target the default 'Local' agent?");
  process.exit(0);
}
const lines = fs.readFileSync(file, "utf8").trim().split("\n");
console.log(lines.slice(-n).join("\n"));
