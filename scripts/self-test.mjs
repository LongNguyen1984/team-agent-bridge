#!/usr/bin/env node
// Offline end-to-end tests against fake Teams flow + fake Telegram API.  npm test
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startMock } from "./mock-flow.mjs";
import { startTelegramMock } from "./mock-telegram.mjs";
import { ROOT } from "../src/lib.mjs";

const FLOW_PORT = 7099;
const TG_PORT = 7098;
const CHAT = 42;

let nextAnswer = { choice: "Continue", comment: "" };
const flow = await startMock({ port: FLOW_PORT, quiet: true, delayMs: 300, autoAnswer: () => nextAnswer });
const tg = await startTelegramMock({ port: TG_PORT });

const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), "tab-home-"));
const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(BRIDGE_|TEAMS_|TELEGRAM_)/.test(k)));
const base = {
  ...clean,
  HOME: fakeHome, USERPROFILE: fakeHome,
  NO_PROXY: "localhost,127.0.0.1", no_proxy: "localhost,127.0.0.1",
  BRIDGE_TIMEOUT_MINUTES: "1",
};
const teamsEnv = {
  ...base,
  BRIDGE_CHANNEL: "teams",
  TEAMS_ASK_FLOW_URL: `http://localhost:${FLOW_PORT}/ask`,
  TEAMS_NOTIFY_WEBHOOK_URL: `http://localhost:${FLOW_PORT}/notify`,
  TEAMS_POLL_SECONDS: "1",
};
const tgEnv = {
  ...base,
  BRIDGE_CHANNEL: "telegram",
  TELEGRAM_BOT_TOKEN: tg.token,
  TELEGRAM_CHAT_ID: String(CHAT),
  TELEGRAM_API_BASE: `http://localhost:${TG_PORT}`,
  TELEGRAM_POLL_TIMEOUT: "1",
};

function runHook(env, event) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, "hooks", "teams-hook.mjs")], { env });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("close", (code) => { try { resolve({ code, json: JSON.parse(out || "{}"), err }); } catch { reject(new Error(`bad hook output: ${out} ${err}`)); } });
    p.stdin.end(JSON.stringify({ timestamp: new Date().toISOString(), cwd: "/work/my-app", ...event }));
  });
}

async function mcpClient(env) {
  const client = new Client({ name: "self-test", version: "1.0.0" });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [path.join(ROOT, "src", "server.mjs")], env, stderr: "ignore" }));
  return client;
}

let passed = 0;
const ok = (name) => { passed++; console.log(`  ✔ ${name}`); };
const pre = { hook_event_name: "PreToolUse", tool_name: "run_in_terminal", tool_input: { command: "rm -rf dist" } };

try {
  // ───────────── Teams channel ─────────────
  console.log("Teams channel — hook");
  let r = await runHook(teamsEnv, pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "ask"); ok("away mode off: gated tool → on-screen confirmation (ask)");

  r = await runHook(teamsEnv, { ...pre, tool_name: "read_file" });
  assert.deepEqual(r.json, { continue: true }); ok("away mode off: other tools untouched");

  r = await runHook(teamsEnv, { hook_event_name: "Stop", stop_hook_active: false });
  assert.deepEqual(r.json, { continue: true }); ok("away mode off: Stop hook idle");

  fs.mkdirSync(path.join(fakeHome, ".teams-agent-bridge"), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, ".teams-agent-bridge", "away"), "x");

  r = await runHook(teamsEnv, { ...pre, tool_name: "read_file" });
  assert.deepEqual(r.json, { continue: true }); ok("non-gated tool passes through");

  nextAnswer = { choice: "Allow", comment: "" };
  r = await runHook(teamsEnv, pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow"); ok("Allow → allow");

  nextAnswer = { choice: "Deny", comment: "use npm run clean instead" };
  r = await runHook(teamsEnv, pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  assert.match(r.json.hookSpecificOutput.additionalContext, /npm run clean/); ok("Deny + comment → deny with context");

  nextAnswer = { choice: "Stop agent", comment: "" };
  r = await runHook(teamsEnv, pre);
  assert.equal(r.json.continue, false); ok("Stop agent → continue:false");

  nextAnswer = { choice: "Continue", comment: "now add tests" };
  r = await runHook(teamsEnv, { hook_event_name: "Stop", stop_hook_active: false });
  assert.equal(r.json.hookSpecificOutput.decision, "block");
  assert.match(r.json.hookSpecificOutput.reason, /now add tests/); ok("Stop hook: Continue + text → keeps agent working");

  nextAnswer = { choice: "Done", comment: "" };
  r = await runHook(teamsEnv, { hook_event_name: "Stop", stop_hook_active: true });
  assert.deepEqual(r.json, { continue: true }); ok("Stop hook: Done → lets agent stop");

  r = await runHook({ ...teamsEnv, TEAMS_ASK_FLOW_URL: "http://localhost:1/nope" }, pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny"); ok("channel unreachable → fail-safe deny");

  console.log("Teams channel — MCP server");
  let client = await mcpClient(teamsEnv);
  const tools = (await client.listTools()).tools.map((t) => t.name).sort();
  assert.deepEqual(tools, ["ask_user_on_phone", "notify_phone", "phone_check_in"]); ok(`tools listed: ${tools.join(", ")}`);

  nextAnswer = { choice: "Stop", comment: "" };
  let res = await client.callTool({ name: "ask_user_on_phone", arguments: { question: "Deploy?" } });
  assert.match(res.content[0].text, /STOP/); ok("ask_user_on_phone → Stop instruction");

  nextAnswer = { choice: "Change plan", comment: "skip the migration" };
  res = await client.callTool({ name: "phone_check_in", arguments: { done: "Refactored API", next: "Run migration" } });
  assert.match(res.content[0].text, /skip the migration/); ok("phone_check_in → comment overrides plan");

  res = await client.callTool({ name: "notify_phone", arguments: { message: "Build green" } });
  assert.match(res.content[0].text, /sent/); assert.ok(flow.notifications.length >= 1); ok("notify_phone → webhook called");
  await client.close();

  // ───────────── Telegram channel ─────────────
  console.log("Telegram channel — hook");
  tg.state.onSend = (m) => tg.press(m, 0); // "Allow"
  r = await runHook(tgEnv, pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow");
  assert.ok(tg.state.edits.some((e) => /✅ <b>Allow<\/b>/.test(e.text))); ok("button Allow → allow, message edited, keyboard removed");

  tg.state.onSend = (m) => tg.text("use npm run clean instead", { replyTo: m });
  r = await runHook(tgEnv, pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "deny");
  assert.match(r.json.hookSpecificOutput.additionalContext, /npm run clean/); ok("text reply → deny + instruction to the model");

  tg.state.onSend = (m) => tg.press(m, 2); // "Stop agent"
  r = await runHook(tgEnv, pre);
  assert.equal(r.json.continue, false); ok("button Stop agent → continue:false");

  tg.state.onSend = () => tg.text("now write the README"); // plain message, not a reply
  r = await runHook(tgEnv, { hook_event_name: "Stop", stop_hook_active: false });
  assert.equal(r.json.hookSpecificOutput.decision, "block");
  assert.match(r.json.hookSpecificOutput.reason, /now write the README/); ok("Stop hook: plain text message → agent keeps working on it");

  tg.state.onSend = (m) => { tg.press(m, 1, 999); setTimeout(() => tg.press(m, 0), 400); }; // stranger taps Deny, then you tap Allow
  r = await runHook(tgEnv, pre);
  assert.equal(r.json.hookSpecificOutput.permissionDecision, "allow");
  assert.ok(tg.state.callbackAnswers.some((a) => /Not authorised/.test(a.text))); ok("buttons from another chat are ignored");

  // Two processes waiting at the same time (e.g. MCP tool + hook): each must get its own answer, no 409s.
  const sent = [];
  tg.state.onSend = (m) => { sent.push(m); if (sent.length === 2) { tg.text("answer for B", { replyTo: sent[1] }); setTimeout(() => tg.press(sent[0], 0), 300); } };
  const conflictsBefore = tg.state.conflicts;
  const [a, b] = await Promise.all([runHook(tgEnv, pre), new Promise((res) => setTimeout(() => res(runHook(tgEnv, pre)), 300))]);
  assert.equal(a.json.hookSpecificOutput.permissionDecision, "allow");
  assert.match(b.json.hookSpecificOutput.additionalContext, /answer for B/);
  assert.equal(tg.state.conflicts, conflictsBefore); ok("two concurrent waiters get the right answers, no polling conflicts");

  console.log("Telegram channel — MCP server");
  client = await mcpClient(tgEnv);
  tg.state.onSend = (m) => tg.press(m, 1); // "Stop"
  res = await client.callTool({ name: "ask_user_on_phone", arguments: { question: "Deploy?", details: "kubectl apply -f prod.yaml" } });
  assert.match(res.content[0].text, /STOP/);
  assert.match(tg.state.messages.get(tg.state.nextMessageId - 1)?.text || [...tg.state.messages.values()].pop().text, /kubectl/); ok("ask_user_on_phone over Telegram → Stop");

  tg.state.onSend = (m) => tg.text("skip the migration", { replyTo: m });
  res = await client.callTool({ name: "phone_check_in", arguments: { done: "Refactored API", next: "Run migration" } });
  assert.match(res.content[0].text, /Change plan/); assert.match(res.content[0].text, /skip the migration/); ok("phone_check_in text reply → Change plan + instruction");

  tg.state.onSend = null;
  const before = tg.state.messages.size;
  res = await client.callTool({ name: "notify_phone", arguments: { message: "Build <green> & done" } });
  assert.match(res.content[0].text, /sent/); assert.equal(tg.state.messages.size, before + 1);
  assert.match([...tg.state.messages.values()].pop().text, /&lt;green&gt; &amp; done/); ok("notify_phone → message sent, HTML escaped");
  await client.close();

  console.log(`\nAll ${passed} checks passed.`);
} catch (e) {
  console.error("\n✘ FAILED:", e);
  process.exitCode = 1;
} finally {
  await flow.close();
  await tg.close();
  fs.rmSync(fakeHome, { recursive: true, force: true });
}
