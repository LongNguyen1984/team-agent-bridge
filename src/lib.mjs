// Shared helpers: config loading, Adaptive Card building, and the two calls
// to Microsoft Teams (ask-and-wait via Power Automate, fire-and-forget notify).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_DIR = path.join(os.homedir(), ".teams-agent-bridge");
export const AWAY_FLAG = path.join(STATE_DIR, "away");

// ---------- config ----------
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

export function loadConfig() {
  loadDotEnv(path.join(ROOT, ".env"));
  const e = process.env;
  const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(v));
  return {
    askFlowUrl: e.TEAMS_ASK_FLOW_URL || "",
    notifyWebhookUrl: e.TEAMS_NOTIFY_WEBHOOK_URL || "",
    timeoutMinutes: Number(e.TEAMS_TIMEOUT_MINUTES || 30),
    pollSeconds: Number(e.TEAMS_POLL_SECONDS || 5),
    machineName: e.TEAMS_MACHINE_NAME || os.hostname(),
    hookEnabled: bool(e.TEAMS_HOOK_ENABLED, true),
    requireAwayFlag: bool(e.TEAMS_REQUIRE_AWAY_FLAG, true),
    gateTools: e.TEAMS_GATE_TOOLS || "run_in_terminal",
    onTimeout: (e.TEAMS_ON_TIMEOUT || "deny").toLowerCase(), // deny | allow
    stopHook: (e.TEAMS_STOP_HOOK || "ask").toLowerCase(), // ask | notify | off
  };
}

export function isAway() {
  return fs.existsSync(AWAY_FLAG);
}

// ---------- Adaptive Card ----------
const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + "\n…(truncated)" : s || "");

/**
 * Build an Adaptive Card (v1.4 — renders on Teams mobile).
 * Each option becomes a button whose id is the option text, so Power Automate's
 * `submitActionId` tells us which one was pressed.
 */
export function buildCard({ title, question, details, options = [], cfg, askComment = true }) {
  const body = [
    { type: "TextBlock", text: title, weight: "Bolder", size: "Medium", wrap: true },
    {
      type: "FactSet",
      facts: [
        { title: "PC", value: cfg.machineName },
        { title: "Time", value: new Date().toLocaleString() },
      ],
    },
    { type: "TextBlock", text: question, wrap: true, spacing: "Medium" },
  ];
  if (details) {
    body.push({
      type: "Container",
      style: "emphasis",
      items: [{ type: "TextBlock", text: truncate(details, 1500), wrap: true, fontType: "Monospace", size: "Small" }],
    });
  }
  if (options.length && askComment) {
    body.push({
      type: "Input.Text",
      id: "comment",
      placeholder: "Optional: extra instructions for the agent",
      isMultiline: true,
    });
  }
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body,
    actions: options.map((o) => ({ type: "Action.Submit", id: o, title: o, data: { choice: o } })),
  };
}

// ---------- Teams calls ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Normalise whatever the flow's Response body looks like into {choice, comment, responder}. */
export function parseFlowAnswer(body) {
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { return { choice: body.trim(), comment: "", responder: "" }; }
  }
  body = body || {};
  const data = body.data || body.body?.data || {};
  const choice = body.choice || data.choice || body.submitActionId || body.body?.submitActionId || "";
  const comment = body.comment || data.comment || "";
  const r = body.responder || body.body?.responder || {};
  const responder = typeof r === "string" ? r : r.displayName || r.userPrincipalName || r.email || "";
  return { choice: String(choice).trim(), comment: String(comment).trim(), responder };
}

/**
 * Post a card to Teams and wait for the user to press a button.
 * Works with the Power Automate "Asynchronous response" pattern (202 + Location polling)
 * and also with a plain synchronous 200 response.
 * Returns {choice, comment, responder} or {choice: "TIMEOUT"}.
 */
export async function askTeams({ title, question, details, options, cfg = loadConfig(), signal }) {
  if (!cfg.askFlowUrl) throw new Error("TEAMS_ASK_FLOW_URL is not set. Copy .env.example to .env and fill it in.");
  const card = buildCard({ title, question, details, options, cfg });
  const deadline = Date.now() + cfg.timeoutMinutes * 60_000;

  let res = await fetch(cfg.askFlowUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title, question, options, machine: cfg.machineName, card: JSON.stringify(card) }),
    signal,
  });

  let location = res.headers.get("location");
  while (res.status === 202 && location) {
    if (Date.now() > deadline) return { choice: "TIMEOUT", comment: "", responder: "" };
    const retry = Number(res.headers.get("retry-after"));
    await sleep((retry > 0 ? Math.min(retry, 30) : cfg.pollSeconds) * 1000);
    res = await fetch(location, { signal });
    location = res.headers.get("location") || location;
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 202) {
      throw new Error("Flow returned 202 without a Location header. Turn ON 'Asynchronous response' in the flow's Response action settings (see docs/SETUP-POWER-AUTOMATE.md).");
    }
    if ([502, 504].includes(res.status) || /timed out|ActionResponseTimedOut/i.test(text)) {
      throw new Error(`Flow timed out (${res.status}). Turn ON 'Asynchronous response' in the Response action settings so the agent can wait longer than 2 minutes.`);
    }
    throw new Error(`Flow call failed: HTTP ${res.status} ${truncate(text, 400)}`);
  }
  return parseFlowAnswer(text);
}

/** Fire-and-forget message (no buttons) via a Teams Workflows webhook. Silently skipped if not configured. */
export async function notifyTeams({ title, message, details, cfg = loadConfig() }) {
  if (!cfg.notifyWebhookUrl) return { sent: false, reason: "TEAMS_NOTIFY_WEBHOOK_URL not set" };
  const card = buildCard({ title, question: message, details, options: [], cfg, askComment: false });
  const res = await fetch(cfg.notifyWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "message",
      attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }],
    }),
  });
  if (!res.ok && res.status !== 202) {
    throw new Error(`Notify webhook failed: HTTP ${res.status} ${truncate(await res.text(), 300)}`);
  }
  return { sent: true };
}
