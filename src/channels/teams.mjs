// Microsoft Teams channel via Power Automate.
//  ask    → HTTP-triggered flow "Post adaptive card and wait for a response" (Premium HTTP trigger)
//  notify → Teams Workflows webhook (free)
import { httpFetch, truncate, sleep } from "../lib.mjs";

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
    body.push({ type: "Input.Text", id: "comment", placeholder: "Optional: extra instructions for the agent", isMultiline: true });
  }
  return {
    $schema: "http://adaptivecards.io/schemas/adaptive-card.json",
    type: "AdaptiveCard",
    version: "1.4",
    body,
    actions: options.map((o) => ({ type: "Action.Submit", id: o, title: o, data: { choice: o } })),
  };
}

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

export async function askTeams({ title, question, details, options, cfg, signal }) {
  if (!cfg.askFlowUrl) throw new Error("TEAMS_ASK_FLOW_URL is not set. Copy .env.example to .env and fill it in.");
  const card = buildCard({ title, question, details, options, cfg });
  const deadline = Date.now() + cfg.timeoutMinutes * 60_000;

  let res = await httpFetch(cfg.askFlowUrl, {
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
    res = await httpFetch(location, { signal });
    location = res.headers.get("location") || location;
  }

  const text = await res.text();
  if (!res.ok) {
    if (res.status === 202) {
      throw new Error("Flow returned 202 without a Location header. Turn ON 'Asynchronous response' in the flow's Response action settings.");
    }
    if ([502, 504].includes(res.status) || /timed out|ActionResponseTimedOut/i.test(text)) {
      throw new Error(`Flow timed out (${res.status}). Turn ON 'Asynchronous response' in the Response action settings.`);
    }
    throw new Error(`Flow call failed: HTTP ${res.status} ${truncate(text, 400)}`);
  }
  return parseFlowAnswer(text);
}

export async function notifyTeams({ title, message, details, cfg }) {
  if (!cfg.notifyWebhookUrl) return { sent: false, reason: "TEAMS_NOTIFY_WEBHOOK_URL not set" };
  const card = buildCard({ title, question: message, details, options: [], cfg, askComment: false });
  const res = await httpFetch(cfg.notifyWebhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "message",
      attachments: [{ contentType: "application/vnd.microsoft.card.adaptive", contentUrl: null, content: card }],
    }),
  });
  if (!res.ok && res.status !== 202) throw new Error(`Notify webhook failed: HTTP ${res.status} ${truncate(await res.text(), 300)}`);
  return { sent: true };
}
