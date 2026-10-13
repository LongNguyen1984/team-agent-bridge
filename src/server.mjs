#!/usr/bin/env node
// MCP server (stdio) that gives the Copilot agent tools to talk to you on Microsoft Teams.
// NOTE: never write to stdout here — stdout is the MCP channel. Log with console.error.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { askTeams, notifyTeams, loadConfig } from "./lib.mjs";

const cfg = loadConfig();
const server = new McpServer({ name: "teams-agent-bridge", version: "1.0.0" });

const text = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });

function interpret({ choice, comment, responder }) {
  const c = choice.toLowerCase();
  let instruction;
  if (choice === "TIMEOUT") {
    instruction = "The user did not answer in time. Do NOT continue with risky or irreversible work. Stop and summarise where you are.";
  } else if (/^(stop|cancel|abort|no|deny)/.test(c)) {
    instruction = "The user said STOP. Stop working immediately, do not run any more tools, and write a short summary of the current state.";
  } else if (comment) {
    instruction = "The user answered and added instructions in `comment`. Follow those instructions; they override your previous plan.";
  } else {
    instruction = `The user chose "${choice}". Proceed accordingly.`;
  }
  return { choice, comment, responder, instruction };
}

server.registerTool(
  "ask_user_on_teams",
  {
    title: "Ask the user on Microsoft Teams",
    description:
      "Send a question to the user's Microsoft Teams (they may be away from the PC, on their phone) and WAIT for their answer. " +
      "Use this for approvals, decisions, or when you are blocked. Returns the button they pressed plus any free-text instructions. " +
      "If the answer says stop, stop immediately.",
    inputSchema: {
      question: z.string().describe("Short, self-contained question. The user will read it on a phone."),
      options: z.array(z.string()).min(1).max(5).default(["Continue", "Stop"]).describe("Button labels."),
      details: z.string().optional().describe("Optional extra context, e.g. a command, diff summary or error (max ~1500 chars shown)."),
    },
  },
  async ({ question, options, details }) => {
    try {
      const ans = await askTeams({ title: "🤖 Copilot agent needs you", question, details, options, cfg });
      return text(interpret(ans));
    } catch (err) {
      console.error("[teams-agent-bridge]", err);
      return { ...text(`Could not reach Teams: ${err.message}. Ask the user in chat instead and do not take irreversible actions.`), isError: true };
    }
  }
);

server.registerTool(
  "teams_check_in",
  {
    title: "Progress check-in on Teams",
    description:
      "Report progress to the user on Microsoft Teams and wait for Continue / Stop / Change plan. " +
      "Call this after finishing each major step of a long task, and before anything destructive (deleting files, migrations, deploys, git push).",
    inputSchema: {
      done: z.string().describe("What you just finished, 1-3 sentences."),
      next: z.string().describe("What you plan to do next, 1-3 sentences."),
    },
  },
  async ({ done, next }) => {
    try {
      const ans = await askTeams({
        title: "📋 Copilot agent check-in",
        question: `**Done:** ${done}\n\n**Next:** ${next}`,
        options: ["Continue", "Change plan", "Stop"],
        cfg,
      });
      return text(interpret(ans));
    } catch (err) {
      console.error("[teams-agent-bridge]", err);
      return { ...text(`Could not reach Teams: ${err.message}. Continue only with safe, reversible work.`), isError: true };
    }
  }
);

server.registerTool(
  "notify_teams",
  {
    title: "Send a Teams notification",
    description: "Send a one-way status message to the user's Microsoft Teams (does not wait for a reply). Use for 'task finished' or 'build failed' updates.",
    inputSchema: {
      message: z.string(),
      details: z.string().optional(),
    },
  },
  async ({ message, details }) => {
    try {
      const r = await notifyTeams({ title: "🔔 Copilot agent update", message, details, cfg });
      return text(r.sent ? "Notification sent." : `Not sent: ${r.reason}.`);
    } catch (err) {
      console.error("[teams-agent-bridge]", err);
      return { ...text(`Notify failed: ${err.message}`), isError: true };
    }
  }
);

await server.connect(new StdioServerTransport());
console.error(`[teams-agent-bridge] MCP server ready on ${cfg.machineName}`);
