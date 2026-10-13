#!/usr/bin/env node
// Connect the bridge to your Telegram bot.
//   npm run telegram:setup                (asks for the token)
//   npm run telegram:setup -- <BOT_TOKEN>
// Writes BRIDGE_CHANNEL, TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID into .env.
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { ROOT, ENV_FILE, STATE_DIR, updateEnvFile, loadConfig, sleep } from "../src/lib.mjs";
import { tg } from "../src/channels/telegram.mjs";

if (!fs.existsSync(ENV_FILE)) fs.copyFileSync(path.join(ROOT, ".env.example"), ENV_FILE);

let token = process.argv[2] || "";
if (!token) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const existing = process.env.TELEGRAM_BOT_TOKEN;
  token = (await rl.question(`Paste your bot token from @BotFather${existing ? " (Enter = keep current)" : ""}: `)).trim() || existing || "";
  rl.close();
}
if (!/^\d+:[\w-]{30,}$/.test(token)) {
  console.error("✘ That doesn't look like a bot token (format 123456789:AA...). Get one from @BotFather → /newbot.");
  process.exit(1);
}

const cfg = { ...loadConfig(), telegramToken: token };

let me;
try {
  me = await tg(cfg, "getMe");
} catch (e) {
  console.error(`✘ Could not reach Telegram: ${e.message}`);
  console.error("  Check the token, and that this PC can open https://api.telegram.org (company proxy? set HTTPS_PROXY in .env).");
  process.exit(1);
}
await tg(cfg, "deleteWebhook", { drop_pending_updates: false }).catch(() => {});
console.log(`✔ Bot found: @${me.username}`);
console.log(`\n→ On your phone, open Telegram, search for @${me.username}, tap START (or send "hi").`);
console.log("  Waiting up to 3 minutes…");

const started = Date.now();
let found = null;
let offset = 0;
while (!found && Date.now() - started < 180_000) {
  const updates = await tg(cfg, "getUpdates", { offset, timeout: 20, allowed_updates: ["message"] });
  for (const u of updates) {
    offset = u.update_id + 1;
    const m = u.message;
    if (m && m.date * 1000 > started - 5 * 60_000) found = m;
  }
  if (!found) await sleep(200);
}
if (offset) await tg(cfg, "getUpdates", { offset, timeout: 0 }).catch(() => {}); // mark as read

if (!found) {
  console.error("✘ No message received. Send /start to the bot and run this again.");
  process.exit(1);
}

const chatId = String(found.chat.id);
if (found.chat.type !== "private") {
  console.log(`⚠ That message came from a ${found.chat.type} chat. Anyone in it could approve actions — a private chat with the bot is safer.`);
}
fs.mkdirSync(path.join(STATE_DIR, "telegram"), { recursive: true });
fs.writeFileSync(path.join(STATE_DIR, "telegram", "offset"), String(offset));
updateEnvFile({ BRIDGE_CHANNEL: "telegram", TELEGRAM_BOT_TOKEN: token, TELEGRAM_CHAT_ID: chatId });

await tg({ ...cfg, telegramChatId: chatId }, "sendMessage", {
  chat_id: chatId,
  text: `✅ Connected to ${cfg.machineName}.\nThe Copilot agent will ask you here. Only this chat (${found.from?.first_name || chatId}) can answer.`,
});
console.log(`✔ Linked to ${found.from?.first_name || ""} (chat id ${chatId}) and saved to .env`);
console.log("\nNext: npm run test:ask");
