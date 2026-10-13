// Shared helpers: config loading, HTTP (with corporate proxy support), and a
// channel-neutral ask()/notify() that routes to Telegram or Microsoft Teams.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetch as undiciFetch, EnvHttpProxyAgent } from "undici";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const STATE_DIR = path.join(os.homedir(), ".teams-agent-bridge");
export const AWAY_FLAG = path.join(STATE_DIR, "away");
export const ENV_FILE = path.join(ROOT, ".env");

// ---------- .env ----------
function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv(ENV_FILE);

/** Set (or add) KEY=value lines in .env, keeping everything else. */
export function updateEnvFile(values) {
  let text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, "utf8") : "";
  for (const [k, v] of Object.entries(values)) {
    const re = new RegExp(`^\\s*${k}\\s*=.*$`, "m");
    text = re.test(text) ? text.replace(re, `${k}=${v}`) : `${text.replace(/\s*$/, "")}\n${k}=${v}\n`;
    process.env[k] = String(v);
  }
  fs.writeFileSync(ENV_FILE, text);
}

// ---------- HTTP (honours HTTPS_PROXY / HTTP_PROXY / NO_PROXY, common on company PCs) ----------
const e0 = process.env;
const proxyAgent = e0.HTTPS_PROXY || e0.https_proxy || e0.HTTP_PROXY || e0.http_proxy ? new EnvHttpProxyAgent() : null;
export async function httpFetch(url, opts = {}) {
  try {
    return await (proxyAgent ? undiciFetch(url, { ...opts, dispatcher: proxyAgent }) : fetch(url, opts));
  } catch (e) {
    // Node only says "fetch failed"; surface the real network reason (DNS, timeout, reset, TLS…).
    const c = e.cause || {};
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    const reason = [c.code, c.message].filter(Boolean).join(" ") || e.message;
    const hint =
      /ENOTFOUND|EAI_AGAIN/.test(reason) ? " (DNS cannot resolve the host — blocked or offline)"
      : /TIMEOUT|ETIMEDOUT|ECONNRESET|ECONNREFUSED|UND_ERR_SOCKET/.test(reason) ? " (connection blocked or timed out — firewall/ISP block, or a proxy is required)"
      : /CERT|SSL|TLS/i.test(reason) ? " (TLS/certificate problem — company HTTPS inspection?)"
      : "";
    const err = new Error(`cannot reach ${host}: ${reason}${hint}`);
    err.cause = e;
    throw err;
  }
}

// ---------- config ----------
export function loadConfig() {
  const e = process.env;
  const bool = (v, d) => (v === undefined || v === "" ? d : /^(1|true|yes|on)$/i.test(v));
  const channel = (e.BRIDGE_CHANNEL || (e.TELEGRAM_BOT_TOKEN ? "telegram" : "teams")).toLowerCase();
  return {
    channel,
    // Telegram
    telegramToken: e.TELEGRAM_BOT_TOKEN || "",
    telegramChatId: e.TELEGRAM_CHAT_ID || "",
    telegramApiBase: e.TELEGRAM_API_BASE || "https://api.telegram.org",
    telegramPollTimeout: Number(e.TELEGRAM_POLL_TIMEOUT || 20),
    // Teams (Power Automate)
    askFlowUrl: e.TEAMS_ASK_FLOW_URL || "",
    notifyWebhookUrl: e.TEAMS_NOTIFY_WEBHOOK_URL || "",
    // common
    timeoutMinutes: Number(e.BRIDGE_TIMEOUT_MINUTES || e.TEAMS_TIMEOUT_MINUTES || 30),
    pollSeconds: Number(e.TEAMS_POLL_SECONDS || 5),
    machineName: e.BRIDGE_MACHINE_NAME || e.TEAMS_MACHINE_NAME || os.hostname(),
    hookEnabled: bool(e.BRIDGE_HOOK_ENABLED ?? e.TEAMS_HOOK_ENABLED, true),
    requireAwayFlag: bool(e.BRIDGE_REQUIRE_AWAY_FLAG ?? e.TEAMS_REQUIRE_AWAY_FLAG, true),
    gateTools: e.BRIDGE_GATE_TOOLS || e.TEAMS_GATE_TOOLS || "run_in_terminal",
    onTimeout: (e.BRIDGE_ON_TIMEOUT || e.TEAMS_ON_TIMEOUT || "deny").toLowerCase(),
    stopHook: (e.BRIDGE_STOP_HOOK || e.TEAMS_STOP_HOOK || "ask").toLowerCase(),
  };
}

export function isAway() {
  return fs.existsSync(AWAY_FLAG);
}

export const truncate = (s, n) => (s && s.length > n ? s.slice(0, n) + "\n…(truncated)" : s || "");
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- channel-neutral API ----------
/**
 * Ask the user on their phone and wait.
 * @param {object} o
 * @param {string} o.title
 * @param {string} o.question   may contain **bold**
 * @param {string} [o.details]  shown monospace (command, diff…)
 * @param {string[]} o.options  button labels
 * @param {string} [o.textChoice] choice reported when the user answers with text only (Telegram reply)
 * @returns {Promise<{choice:string, comment:string, responder:string}>}  choice === "TIMEOUT" on timeout
 */
export async function ask(o) {
  const cfg = o.cfg || loadConfig();
  if (cfg.channel === "telegram") {
    const { askTelegram } = await import("./channels/telegram.mjs");
    return askTelegram({ ...o, cfg });
  }
  const { askTeams } = await import("./channels/teams.mjs");
  return askTeams({ ...o, cfg });
}

/** One-way message. Returns {sent:boolean, reason?}. */
export async function notify(o) {
  const cfg = o.cfg || loadConfig();
  if (cfg.channel === "telegram") {
    const { notifyTelegram } = await import("./channels/telegram.mjs");
    return notifyTelegram({ ...o, cfg });
  }
  const { notifyTeams } = await import("./channels/teams.mjs");
  return notifyTeams({ ...o, cfg });
}
