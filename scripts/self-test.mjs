#!/usr/bin/env node
// Offline end-to-end test against the mock flow (no Teams needed).  npm test
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMock } from "./mock-flow.mjs";
import { ROOT } from "../src/lib.mjs";

const PORT = 7099;
// Answer depends on the card title so we can exercise every branch.
let nextAnswer = { choice: "Continue", comment: "" };
const mock = await startMock({ port: PORT, quiet: true, delayMs: 300, autoAnswer: () => nextAnswer });

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "tab-home-"));
const env = {
  ...process.env,
  HOME: fakeHome, USERPROFILE: fakeHome,
  TEAMS_ASK_FLOW_URL: `http://localhost:${PORT}/ask`,
  TEAMS_NOTIFY_WEBHOOK_URL: `http://localhost:${PORT}/notify`,
  TEAMS_POLL_SECONDS: "1",
  TEAMS_TIMEOUT_MINUTES: "1",
};

function runHook(event, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, "hooks", "teams-hook.mjs")], { env: { ...env, ...extraEnv } });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => { try { resolve({ code, json: JSON.parse(out || "{}"), err }); } catch (e) { reject(new Error(`bad hook output: ${out} ${err}`)); } });
    p.stdin.end(JSON.stringify({ timestamp: new Date().toISOString(), cwd: "/work/my-app", ...event }));
  });
}

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✔ ${name}`); };

try {
  console.log("Hook");
  const pre = { hook_event_name: "PreToolUse", tool_name: "run_in_terminal", tool_input: { command: "rm -rf dist" } };

  let r = await runHook(pre);
  assert.deepEqual(r.json, { continue: true }); ok("idle when away mode is off");

  fs.mkdirSync(path.join(fakeHome, ".teams-agent-bridge"), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".teams-agent-bridge", "away"), "x");

  r = await runHook({ ...pre, tool_name: "read_file" });
  assert.deepEqual(r.json, { continue: true }); ok("non-gated tool passes through");

  nextAnswer = { choice: "Allow", comment: "" };
  r = await runHook(pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow"); ok("Allow → allow");

  nextAnswer = { choice: "Deny", comment: "use npm run clean instead" };
  r = await runHook(pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  assert.match(r.json.hookSpecificOutput.additionalContext, /npm run clean/); ok("Deny + comment → deny with context");

  nextAnswer = { choice: "Stop agent", comment: "" };
  r = await runHook(pre);
  assert.equal(r.json.continue, false); ok("Stop agent → continue:false");

  nextAnswer = { choice: "Continue", comment: "now add tests" };
  r = await runHook({ hook_event_name: "Stop", stop_hook_active: false });
  assert.equal(r.json.hookSpecificOutput.decision, "block");
  assert.match(r.json.hookSpecificOutput.reason, /now add tests/); ok("Stop hook: Continue + text → keeps agent working");

  nextAnswer = { choice: "Done", comment: "" };
  r = await runHook({ hook_event_name: "Stop", stop_hook_active: true });
  assert.deepEqual(r.json, { continue: true }); ok("Stop hook: Done → lets agent stop");

  r = await runHook(pre, { TEAMS_ASK_FLOW_URL: "http://localhost:1/nope" });
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny"); ok("Teams unreachable → fail safe deny");

  console.log("MCP server");
  const client = new Client({ name: "self-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env }));
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["ask_user_on_teams", "notify_teams", "teams_check_in"]); ok(`tools listed: ${tools.join(", ")}`);

  nextAnswer = { choice: "Stop", comment: "" };
  let res = await client.callTool({ name: "ask_user_on_teams", arguments: { question: "Deploy?" } });
  assert.match(res.content[0].text, /STOP/); ok("ask_user_on_teams → Stop instruction");

  nextAnswer = { choice: "Change plan", comment: "skip the migration" };
  res = await client.callTool({ name: "teams_check_in", arguments: { done: "Refactored API", next: "Run migration" } });
  assert.match(res.content[0].text, /skip the migration/); ok("teams_check_in → comment overrides plan");

  res = await client.callTool({ name: "notify_teams", arguments: { message: "Build green" } });
  assert.match(res.content[0].text, /sent/); assert.ok(mock.notifications.length >= 1); ok("notify_teams → webhook called");
  await client.close();

  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error("\n✘ FAILED:", e);
  process.exitCode = 1;
} finally {
  await mock.close();
  fs.rmSync(fakeHome, { recursive: true, force: true });
}
