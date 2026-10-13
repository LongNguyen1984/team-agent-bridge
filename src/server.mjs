#!/usr/bin/env node
// MCP server (stdio) that lets the Copilot agent reach you on your phone (Telegram or Teams).
// NOTE: never write to stdout here — stdout is the MCP channel. Log with console.error.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ask, notify, loadConfig } from "./lib.mjs";

const cfg = loadConfig();
const server = new McpServer({ name: "teams-agent-bridge", version: "1.1.0" });

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

function interpret({ choice, comment, responder }) {
  const c = choice.toLowerCase();
  let instruction;
  if (choice === "TIMEOUT") {
    instruction = "The user did not answer in time. Do NOT continue with risky or irreversible work. Stop and summarise where you are.";
  } else if (/^(stop|cancel|abort|no|deny)/.test(c) && !comment) {
    instruction = "The user said STOP. Stop working immediately, do not run any more tools, and write a short summary of the current state.";
  } else if (comment) {
    instruction = "The user answered with instructions in `comment`. Follow them; they override your previous plan.";
  } else {
    instruction = `The user chose "${choice}". Proceed accordingly.`;
  }
  return { choice, comment, responder, instruction };
}

const unreachable = (err, fallback) => {
  console.error("[teams-agent-bridge]", err);
  return { ...text(`Could not reach the user's phone (${cfg.channel}): ${err.message}. ${fallback}`), isError: true };
};

server.registerTool(
  "ask_user_on_phone",
  {
    title: "Ask the user on their phone",
    description:
      `Send a question to the user's phone (${cfg.channel}) — they may be away from the PC — and WAIT for the answer. ` +
      "Use for approvals, decisions, or when you are blocked. Returns the button they pressed and/or text instructions. " +
      "If the answer says stop, stop immediately.",
    inputSchema: {
      question: z.string().describe("Short, self-contained question. The user reads it on a phone without seeing the editor."),
      options: z.array(z.string()).min(1).max(6).default(["Continue", "Stop"]).describe("Button labels."),
      details: z.string().optional().describe("Optional context, e.g. a command, diff summary or error (max ~1500 chars shown)."),
    },
  },
  async ({ question, options, details }) => {
    try {
      return text(interpret(await ask({ title: "🤖 Copilot agent needs you", question, details, options, textChoice: "Reply", cfg })));
    } catch (err) {
      return unreachable(err, "Ask the user in chat instead and do not take irreversible actions.");
    }
  }
);

server.registerTool(
  "phone_check_in",
  {
    title: "Progress check-in on the user's phone",
    description:
      "Report progress to the user's phone and wait for Continue / Change plan / Stop. " +
      "Call after finishing each major step of a long task, and before anything destructive (deleting files, migrations, deploys, git push).",
    inputSchema: {
      done: z.string().describe("What you just finished, 1-3 sentences."),
      next: z.string().describe("What you plan to do next, 1-3 sentences."),
    },
  },
  async ({ done, next }) => {
    try {
      return text(interpret(await ask({
        title: "📋 Copilot agent check-in",
        question: `**Done:** ${done}\n\n**Next:** ${next}`,
        options: ["Continue", "Change plan", "Stop"],
        textChoice: "Change plan",
        cfg,
      })));
    } catch (err) {
      return unreachable(err, "Continue only with safe, reversible work.");
    }
  }
);

server.registerTool(
  "notify_phone",
  {
    title: "Send a phone notification",
    description: "Send a one-way status message to the user's phone (does not wait). Use for 'task finished' or 'build failed' updates.",
    inputSchema: { message: z.string(), details: z.string().optional() },
  },
  async ({ message, details }) => {
    try {
      const r = await notify({ title: "🔔 Copilot agent update", message, details, cfg });
      return text(r.sent ? "Notification sent." : `Not sent: ${r.reason}.`);
    } catch (err) {
      return unreachable(err, "");
    }
  }
);

await server.connect(new StdioServerTransport());
console.error(`[teams-agent-bridge] MCP server ready on ${cfg.machineName} (channel: ${cfg.channel})`);
