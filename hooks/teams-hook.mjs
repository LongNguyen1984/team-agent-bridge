#!/usr/bin/env node
// VS Code agent hook (Local harness) — enforced remote control from your phone (Telegram or Teams).
//
//  PreToolUse : for tools matching BRIDGE_GATE_TOOLS, send an approval request to your phone and BLOCK
//               the tool until you tap Allow / Deny / Stop agent on your phone.
//  Stop       : when the agent finishes, ask "Done or continue?". Text you type becomes the
//               agent's next instruction, so you can keep it working from your phone.
//
// Only active while "away mode" is on (npm run away / npm run back), unless
// BRIDGE_REQUIRE_AWAY_FLAG=false. Output format: VS Code Local hooks reference.
import path from "node:path";
import { ask, notify, loadConfig, isAway } from "../src/lib.mjs";

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

  // At your desk (away mode off): make VS Code show its normal on-screen confirmation.
  // This keeps you protected even when VS Code's own terminal auto-approve is turned on.
  if (atDesk) {
    return out({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "ask",
        permissionDecisionReason: "Away mode is off — confirm on screen (run `npm run away` to approve from your phone).",
      },
    });
  }

  const workspace = event.cwd ? path.basename(event.cwd) : "workspace";
  let ans;
  try {
    ans = await ask({
      title: "⚠️ Approve agent action?",
      question: `Copilot wants to run **${event.tool_name}** in **${workspace}**.`,
      details: describeTool(event),
      options: ["Allow", "Deny", "Stop agent"],
      textChoice: "Deny", // a text reply = "don't do that, do this instead"
      cfg,
    });
  } catch (err) {
    // Fail safe: if the phone channel is unreachable, block the action and tell the model why.
    return out({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Phone approval unavailable: ${err.message}`,
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
        permissionDecisionReason: `No answer on the phone within ${cfg.timeoutMinutes} min (policy: ${cfg.onTimeout}).`,
      },
    });
  }
  if (choice.startsWith("stop")) {
    return out({
      continue: false,
      stopReason: `Stopped from phone${ans.responder ? ` by ${ans.responder}` : ""}${ans.comment ? `: ${ans.comment}` : ""}`,
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: "User pressed Stop agent on the phone." },
    });
  }
  const allow = choice.startsWith("allow");
  return out({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: allow ? "allow" : "deny",
      permissionDecisionReason: allow ? "Approved on the phone." : "Denied on the phone.",
      ...(ans.comment ? { additionalContext: `Message from the user (via phone): ${ans.comment}. Follow it instead of the blocked action.` } : {}),
    },
  });
}

async function onStop(event) {
  if (atDesk || cfg.stopHook === "off") return pass();
  const workspace = event.cwd ? path.basename(event.cwd) : "workspace";

  if (cfg.stopHook === "notify") {
    try { await notify({ title: "✅ Copilot agent finished", message: `The agent stopped in **${workspace}**.`, cfg }); } catch {}
    return pass();
  }

  let ans;
  try {
    ans = await ask({
      title: "✅ Copilot agent finished",
      question: `The agent stopped in **${workspace}**. Send new instructions to keep it working, or tap **Done**.`,
      options: ["Done", "Continue"],
      textChoice: "Continue",
      cfg,
    });
  } catch {
    return pass(); // never trap the agent because the phone channel is down
  }

  if (ans.choice.toLowerCase().startsWith("continue")) {
    const reason = ans.comment || "The user asked you to continue. Carry on with the next logical step of the task.";
    return out({ hookSpecificOutput: { hookEventName: "Stop", decision: "block", reason: `Instruction from the user (via phone): ${reason}` } });
  }
  return pass();
}

const raw = await readStdin();
let event = {};
try { event = JSON.parse(raw || "{}"); } catch { pass(); }

if (!cfg.hookEnabled) pass();
const atDesk = cfg.requireAwayFlag && !isAway();

switch (event.hook_event_name) {
  case "PreToolUse": await onPreToolUse(event); break;
  case "Stop": await onStop(event); break;
  default: pass();
}
