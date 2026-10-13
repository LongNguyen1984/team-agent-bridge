#!/usr/bin/env node
// Local stand-in for the Power Automate flow + Teams webhook, for testing without Teams.
// Mimics the "Asynchronous response" pattern: POST → 202 + Location, poll until answered.
//
//   npm run mock            → listens on http://localhost:7071
//   then in .env:  TEAMS_ASK_FLOW_URL=http://localhost:7071/ask
//                  TEAMS_NOTIFY_WEBHOOK_URL=http://localhost:7071/notify
// Answer pending cards in the terminal by typing e.g.:  1 Continue looks good
import http from "node:http";
import readline from "node:readline";

export function startMock({ port = 7071, autoAnswer = null, delayMs = 1500, quiet = false } = {}) {
  const pending = new Map(); // id -> {card, answer}
  const notifications = [];
  let next = 1;
  const log = (...a) => { if (!quiet) console.log(...a); };

  const server = http.createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    const url = new URL(req.url, `http://localhost:${port}`);

    if (req.method === "POST" && url.pathname === "/ask") {
      const id = String(next++);
      const payload = JSON.parse(body || "{}");
      const card = JSON.parse(payload.card || "{}");
      pending.set(id, { card, answer: null });
      log(`\n[#${id}] ${payload.title}\n  ${payload.question}\n  options: ${(payload.options || []).join(" | ")}`);
      if (autoAnswer) {
        setTimeout(() => {
          const a = typeof autoAnswer === "function" ? autoAnswer(payload) : autoAnswer;
          pending.get(id).answer = a;
        }, delayMs);
      } else {
        log(`  → type: ${id} <option> [comment]`);
      }
      res.writeHead(202, { Location: `http://localhost:${port}/status/${id}`, "Retry-After": "1" });
      return res.end();
    }

    if (req.method === "GET" && url.pathname.startsWith("/status/")) {
      const item = pending.get(url.pathname.split("/").pop());
      if (!item) { res.writeHead(404); return res.end("unknown"); }
      if (!item.answer) { res.writeHead(202, { Location: `http://localhost:${port}${url.pathname}`, "Retry-After": "1" }); return res.end(); }
      // Shape matches Power Automate's "Post adaptive card and wait for a response" body.
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        submitActionId: item.answer.choice,
        data: { choice: item.answer.choice, comment: item.answer.comment || "" },
        responder: { displayName: "Mock User" },
      }));
    }

    if (req.method === "POST" && url.pathname === "/notify") {
      const msg = JSON.parse(body || "{}");
      notifications.push(msg);
      const card = msg.attachments?.[0]?.content;
      log(`\n[notify] ${card?.body?.[0]?.text} — ${card?.body?.[2]?.text}`);
      res.writeHead(202); return res.end();
    }

    res.writeHead(404); res.end();
  });

  return new Promise((resolve) => server.listen(port, () => resolve({
    server, pending, notifications,
    answer(id, choice, comment = "") { const p = pending.get(String(id)); if (p) p.answer = { choice, comment }; return !!p; },
    close: () => new Promise((r) => server.close(r)),
  })));
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("mock-flow.mjs")) {
  const mock = await startMock({ port: Number(process.env.MOCK_PORT || 7071) });
  console.log("Mock flow on http://localhost:7071  (POST /ask, POST /notify)");
  const rl = readline.createInterface({ input: process.stdin });
  rl.on("line", (line) => {
    const [id, choice, ...rest] = line.trim().split(/\s+/);
    if (!id || !choice) return;
    console.log(mock.answer(id, choice, rest.join(" ")) ? `  ✔ answered #${id}` : `  ✘ no card #${id}`);
  });
}
