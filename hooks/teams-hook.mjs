#!/usr/bin/env node
// VS Code agent hook (Local harness) — enforced remote control from Teams.
//
//  PreToolUse : for tools matching TEAMS_GATE_TOOLS, post an approval card to Teams and BLOCK
//               the tool until you tap Allow / Deny / Stop agent on your phone.
//  Stop       : when the agent finishes, ask "Done or continue?". Text you type becomes the
//               agent's next instruction, so you can keep it working from your phone.
//
// Only active while "away mode" is on (npm run away / npm run back), unless
// TEAMS_REQUIRE_AWAY_FLAG=false. Output format: VS Code Local hooks reference.
import path from "node:path";
import { askTeams, notifyTeams, loadConfig, isAway } from "../src/lib.mjs";

const cfg = loadConfig();
const out = (obj) => { process.stdout.write(JSON.stringify(obj)); process.exit(0); };
const pass = () => out({ continue: true });

function readStdin() {
  return new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
  });
}

function describeTool(event) {
  const input = event.tool_input || {};
  const cmd = input.command || input.cmd || input.commandLine;
  if (cmd) return `$ ${cmd}${input.explanation ? `\n\n# ${input.explanation}` : ""}`;
  return JSON.stringify(input, null, 2);
}

async function onPreToolUse(event) {
  let gate;
  try { gate = new RegExp(cfg.gateTools, "i"); } catch { gate = /run_in_terminal/i; }
  if (!gate.test(event.tool_name || "")) return pass();

  const workspace = event.cwd ? path.basename(event.cwd) : "workspace";
  let ans;
  try {
    ans = await askTeams({
      title: "⚠️ Approve agent action?",
      question: `Copilot wants to run **${event.tool_name}** in **${workspace}**.`,
      details: describeTool(event),
      options: ["Allow", "Deny", "Stop agent"],
      cfg,
    });
  } catch (err) {
    // Fail safe: if Teams is unreachable, block the action and tell the model why.
    return out({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Teams approval unavailable: ${err.message}`,
      },
    });
  }

  const choice = ans.choice.toLowerCase();
  if (ans.choice === "TIMEOUT") {
    const allow = cfg.onTimeout === "allow";
    return out({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: allow ? "allow" : "deny",
        permissionDecisionReason: `No answer on Teams within ${cfg.timeoutMinutes} min (policy: ${cfg.onTimeout}).`,
      },
    });
  }
  if (choice.startsWith("stop")) {
    return out({
      continue: false,
      stopReason: `Stopped from Teams${ans.responder ? ` by ${ans.responder}` : ""}${ans.comment ? `: ${ans.comment}` : ""}`,
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "User pressed Stop agent on Teams." },
    });
  }
  const allow = choice.startsWith("allow");
  return out({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: allow ? "allow" : "deny",
      permissionDecisionReason: allow ? "Approved on Teams." : "Denied on Teams.",
      ...(ans.comment ? { additionalContext: `Message from the user via Teams: ${ans.comment}` } : {}),
    },
  });
}

async function onStop(event) {
  if (cfg.stopHook === "off") return pass();
  const workspace = event.cwd ? path.basename(event.cwd) : "workspace";

  if (cfg.stopHook === "notify") {
    try { await notifyTeams({ title: "✅ Copilot agent finished", message: `The agent stopped in **${workspace}**.`, cfg }); } catch {}
    return pass();
  }

  let ans;
  try {
    ans = await askTeams({
      title: "✅ Copilot agent finished",
      question: `The agent stopped in **${workspace}**. Type new instructions and tap **Continue** to keep it working, or tap **Done**.`,
      options: ["Done", "Continue"],
      cfg,
    });
  } catch {
    return pass(); // never trap the agent because Teams is down
  }

  if (ans.choice.toLowerCase().startsWith("continue")) {
    const reason = ans.comment || "The user asked you to continue. Carry on with the next logical step of the task.";
    return out({ hookSpecificOutput: { hookEventName: "Stop", decision: "block", reason: `Instruction from the user via Teams: ${reason}` } });
  }
  return pass();
}

const raw = await readStdin();
let event = {};
try { event = JSON.parse(raw || "{}"); } catch { pass(); }

if (!cfg.hookEnabled || (cfg.requireAwayFlag && !isAway())) pass();

switch (event.hook_event_name) {
  case "PreToolUse": await onPreToolUse(event); break;
  case "Stop": await onStop(event); break;
  default: pass();
}
