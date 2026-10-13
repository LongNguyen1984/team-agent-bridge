// Minimal fake Telegram Bot API for offline tests.
// Flags a 409 Conflict if two getUpdates calls overlap (like the real API), so tests can
// prove the bridge's polling lock works.
import http from "node:http";

export function startTelegramMock({ port = 7098, token = "123456789:TEST_TOKEN_abcdefghijklmnopqrstuvwxyz" } = {}) {
  const state = {
    messages: new Map(), // message_id -> {chat_id, text, reply_markup}
    updates: [],
    nextUpdateId: 1000,
    nextMessageId: 1,
    conflicts: 0,
    activePolls: 0,
    onSend: null, // (msg) => void
    edits: [],
    callbackAnswers: [],
  };
  const waiters = new Set();
  const wake = () => { for (const w of waiters) w(); };

  const push = (u) => { state.updates.push({ update_id: state.nextUpdateId++, ...u }); wake(); };
  const now = () => Math.floor(Date.now() / 1000);

  const api = {
    getMe: () => ({ id: 1, is_bot: true, username: "test_bridge_bot" }),
    deleteWebhook: () => true,
    sendMessage: (p) => {
      const m = { message_id: state.nextMessageId++, chat: { id: Number(p.chat_id), type: "private" }, date: now(), text: p.text, reply_markup: p.reply_markup };
      state.messages.set(m.message_id, m);
      if (state.onSend) setTimeout(() => state.onSend(m), 50);
      return m;
    },
    editMessageText: (p) => { state.edits.push(p); const m = state.messages.get(p.message_id); if (m) { m.text = p.text; m.reply_markup = p.reply_markup; } return true; },
    answerCallbackQuery: (p) => { state.callbackAnswers.push(p); return true; },
    getUpdates: async (p) => {
      if (state.activePolls > 0) { state.conflicts++; throw Object.assign(new Error("Conflict: terminated by other getUpdates request"), { code: 409 }); }
      state.activePolls++;
      try {
        if (p.offset) state.updates = state.updates.filter((u) => u.update_id >= p.offset);
        if (!state.updates.length && p.timeout) {
          await new Promise((r) => { const w = () => { waiters.delete(w); r(); }; waiters.add(w); setTimeout(w, p.timeout * 1000); });
        }
        return state.updates.slice();
      } finally {
        state.activePolls--;
      }
    },
  };

  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const m = req.url.match(/^\/bot([^/]+)\/(\w+)/);
    const reply = (code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
    if (!m || m[1] !== token) return reply(401, { ok: false, error_code: 401, description: "Unauthorized" });
    const fn = api[m[2]];
    if (!fn) return reply(404, { ok: false, error_code: 404, description: "Not Found" });
    try { reply(200, { ok: true, result: await fn(JSON.parse(body || "{}")) }); }
    catch (e) { reply(e.code || 500, { ok: false, error_code: e.code || 500, description: e.message }); }
  });

  return new Promise((resolve) => server.listen(port, () => resolve({
    state, token,
    /** Simulate the user tapping button `index` on message `msg`. */
    press(msg, index, chatId = msg.chat.id) {
      const row = msg.reply_markup.inline_keyboard.flat()[index];
      push({ callback_query: { id: `cb${state.nextUpdateId}`, from: { id: chatId, first_name: "Long" }, message: { message_id: msg.message_id, chat: { id: chatId } }, data: row.callback_data } });
    },
    /** Simulate the user sending text (optionally as a reply to `replyTo`). */
    text(text, { chatId = 42, replyTo } = {}) {
      push({ message: { message_id: state.nextMessageId++, from: { id: chatId, first_name: "Long" }, chat: { id: chatId, type: "private" }, date: now(), text, ...(replyTo ? { reply_to_message: { message_id: replyTo.message_id } } : {}) } });
    },
    close: () => new Promise((r) => { wake(); server.close(r); server.closeAllConnections?.(); }),
  })));
}
