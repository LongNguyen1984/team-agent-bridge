// Telegram channel via the Bot API (plain HTTPS — nothing to install on the PC).
//
// Several processes may wait for answers at the same time (the MCP server and one or more
// hook runs). Telegram allows only ONE getUpdates call per bot at a time, so processes take
// turns through a lock file; whoever holds the lock drops every update into a shared inbox
// folder and each waiter claims the updates that belong to its own question.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { httpFetch, STATE_DIR, truncate, sleep } from "../lib.mjs";

const TG_DIR = path.join(STATE_DIR, "telegram");
const INBOX = path.join(TG_DIR, "updates");
const PENDING = path.join(TG_DIR, "pending");
const LOCK = path.join(TG_DIR, "poll.lock");
const OFFSET = path.join(TG_DIR, "offset");
const STALE_LOCK_MS = 60_000;
const INBOX_TTL_MS = 15 * 60_000;

const ensureDirs = () => { fs.mkdirSync(INBOX, { recursive: true }); fs.mkdirSync(PENDING, { recursive: true }); };

export async function tg(cfg, method, params = {}) {
  if (!cfg.telegramToken) throw new Error("TELEGRAM_BOT_TOKEN is not set. Run: npm run telegram:setup");
  const res = await httpFetch(`${cfg.telegramApiBase}/bot${cfg.telegramToken}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  let body;
  try { body = await res.json(); } catch { body = { ok: false, description: `HTTP ${res.status}` }; }
  if (!body.ok) {
    const err = new Error(`Telegram ${method} failed: ${body.description || res.status}`);
    err.code = body.error_code || res.status;
    throw err;
  }
  return body.result;
}

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>"); // allow **bold** from callers

function formatMessage({ title, question, details, cfg, hint = true }) {
  const when = new Date().toLocaleString();
  let html = `<b>${esc(title)}</b>\n🖥 ${esc(cfg.machineName)} · ${esc(when)}\n\n${md(question)}`;
  if (details) html += `\n\n<pre>${esc(truncate(details, 1500))}</pre>`;
  if (hint) html += `\n\n<i>Tap a button, or reply to this message with text to give instructions.</i>`;
  return html.length > 3900 ? html.slice(0, 3900) + "…" : html;
}

// ---------- lock + polling ----------
function tryLock() {
  try {
    fs.writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try {
      if (Date.now() - fs.statSync(LOCK).mtimeMs > STALE_LOCK_MS) { fs.rmSync(LOCK, { force: true }); return tryLock(); }
    } catch {}
    return false;
  }
}
const unlock = () => fs.rmSync(LOCK, { force: true });

async function pollOnce(cfg) {
  if (!tryLock()) { await sleep(700); return; }
  try {
    let offset = 0;
    try { offset = Number(fs.readFileSync(OFFSET, "utf8")) || 0; } catch {}
    let updates = [];
    try {
      updates = await tg(cfg, "getUpdates", { offset, timeout: cfg.telegramPollTimeout, allowed_updates: ["message", "callback_query"] });
    } catch (e) {
      if (e.code === 409) throw new Error("Telegram says another program is reading this bot (409 Conflict). Make sure no other bot script or webhook uses the same token.");
      throw e;
    }
    for (const u of updates) {
      fs.writeFileSync(path.join(INBOX, `${String(u.update_id).padStart(12, "0")}.json`), JSON.stringify({ ...u, _received: Date.now() }));
      offset = Math.max(offset, u.update_id + 1);
    }
    if (updates.length) fs.writeFileSync(OFFSET, String(offset));
  } finally {
    unlock();
  }
}

/** Atomically take ownership of an inbox file; only one process can win. */
function claim(file) {
  const tmp = `${file}.claimed-${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
  try { fs.renameSync(file, tmp); fs.rmSync(tmp, { force: true }); return true; } catch { return false; }
}

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

function pendingAsks() {
  return fs.readdirSync(PENDING).filter((f) => f.endsWith(".json")).map((f) => readJson(path.join(PENDING, f))).filter(Boolean);
}

/** Look through the shared inbox for an answer to `me`. */
async function findAnswer(cfg, me) {
  const chatId = String(cfg.telegramChatId);
  for (const name of fs.readdirSync(INBOX).filter((f) => f.endsWith(".json")).sort()) {
    const file = path.join(INBOX, name);
    const u = readJson(file);
    if (!u) continue;

    const cb = u.callback_query;
    const msg = u.message;
    const fromChat = String(cb ? cb.message?.chat?.id ?? cb.from?.id : msg?.chat?.id);

    // Security: ignore anyone who is not you.
    if (fromChat !== chatId) {
      if (claim(file) && cb) tg(cfg, "answerCallbackQuery", { callback_query_id: cb.id, text: "Not authorised." }).catch(() => {});
      continue;
    }

    if (cb) {
      const [askId, idx] = String(cb.data || "").split(":");
      if (askId === me.askId) {
        if (!claim(file)) continue;
        tg(cfg, "answerCallbackQuery", { callback_query_id: cb.id, text: "Sent to the agent ✔" }).catch(() => {});
        return { choice: me.options[Number(idx)] ?? String(idx), comment: "", responder: cb.from?.first_name || "" };
      }
      // Button of a question nobody is waiting for any more.
      if (!pendingAsks().some((p) => p.askId === askId) && claim(file)) {
        tg(cfg, "answerCallbackQuery", { callback_query_id: cb.id, text: "This question is no longer active." }).catch(() => {});
      }
      continue;
    }

    if (msg?.text) {
      const isCommand = msg.text.startsWith("/");
      const replyTo = msg.reply_to_message?.message_id;
      const pend = pendingAsks();
      const newest = pend.sort((a, b) => b.created - a.created)[0];
      const mineByReply = replyTo === me.messageId;
      const mineAsNewest = !replyTo && !isCommand && newest?.askId === me.askId && msg.date * 1000 >= me.created - 2000;
      if (mineByReply || mineAsNewest) {
        if (!claim(file)) continue;
        return { choice: me.textChoice || "Reply", comment: msg.text.trim(), responder: msg.from?.first_name || "" };
      }
      // Text that answers no waiting question (old message, command, or reply to a finished question).
      const answersSomeone = pend.some((p) => p.messageId === replyTo) || (!replyTo && !isCommand && newest && msg.date * 1000 >= newest.created - 2000);
      if (!answersSomeone && claim(file)) {
        if (!isCommand && msg.date * 1000 > Date.now() - 60_000) {
          tg(cfg, "sendMessage", { chat_id: chatId, text: "No question from the agent is waiting right now.", reply_to_message_id: msg.message_id }).catch(() => {});
        }
      }
      continue;
    }

    // Anything else (stickers, edits…) or very old leftovers: discard.
    if (Date.now() - (u._received || 0) > INBOX_TTL_MS || !msg?.text) claim(file);
  }
  return null;
}

// ---------- public API ----------
export async function askTelegram({ title, question, details, options = ["Continue", "Stop"], textChoice, cfg }) {
  if (!cfg.telegramChatId) throw new Error("TELEGRAM_CHAT_ID is not set. Run: npm run telegram:setup");
  ensureDirs();

  const askId = crypto.randomBytes(4).toString("hex");
  const html = formatMessage({ title, question, details, cfg });
  const keyboard = [];
  options.forEach((o, i) => {
    const btn = { text: o, callback_data: `${askId}:${i}` };
    if (i % 2 === 0) keyboard.push([btn]); else keyboard[keyboard.length - 1].push(btn);
  });

  const sent = await tg(cfg, "sendMessage", {
    chat_id: cfg.telegramChatId,
    text: html,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: keyboard },
  });

  const me = { askId, messageId: sent.message_id, created: Date.now(), options, textChoice };
  const pendingFile = path.join(PENDING, `${askId}.json`);
  fs.writeFileSync(pendingFile, JSON.stringify({ askId, messageId: me.messageId, created: me.created }));

  const deadline = Date.now() + cfg.timeoutMinutes * 60_000;
  try {
    while (Date.now() < deadline) {
      const ans = await findAnswer(cfg, me);
      if (ans) {
        const tail = `\n\n✅ <b>${esc(ans.choice)}</b>${ans.comment ? `: ${esc(truncate(ans.comment, 300))}` : ""}`;
        await tg(cfg, "editMessageText", { chat_id: cfg.telegramChatId, message_id: me.messageId, text: html + tail, parse_mode: "HTML" }).catch(() => {});
        return ans;
      }
      await pollOnce(cfg);
    }
    await tg(cfg, "editMessageText", {
      chat_id: cfg.telegramChatId, message_id: me.messageId, parse_mode: "HTML",
      text: html + `\n\n⏱ <b>No answer in ${cfg.timeoutMinutes} min</b>`,
    }).catch(() => {});
    return { choice: "TIMEOUT", comment: "", responder: "" };
  } finally {
    fs.rmSync(pendingFile, { force: true });
  }
}

export async function notifyTelegram({ title, message, details, cfg }) {
  if (!cfg.telegramChatId) return { sent: false, reason: "TELEGRAM_CHAT_ID not set" };
  await tg(cfg, "sendMessage", {
    chat_id: cfg.telegramChatId,
    text: formatMessage({ title, question: message, details, cfg, hint: false }),
    parse_mode: "HTML",
  });
  return { sent: true };
}
