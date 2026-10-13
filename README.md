# teams-agent-bridge

Control the **GitHub Copilot agent running in VS Code on your PC** from **Microsoft Teams on your phone**: approve commands, give it new instructions, or stop it, without going back to your desk.

```
 VS Code on your PC                          Microsoft 365 cloud                Your phone
┌──────────────────────────┐   HTTPS out   ┌───────────────────────────┐      ┌───────────────┐
│ Copilot agent            │──────────────▶│ Power Automate flow       │─────▶│ Teams card    │
│  ├─ MCP tools  ──────────┤               │ "post card & wait"        │      │ [Allow][Deny] │
│  └─ hooks (enforced) ────┤◀──────────────│ returns your button+text  │◀─────│ [Stop] + text │
└──────────────────────────┘  poll answer  └───────────────────────────┘      └───────────────┘
```

There are two layers. You can use either one, or both.

| Layer | What it does | Can the model skip it? |
|---|---|---|
| **MCP tools** (`src/server.mjs`) | The agent can call `ask_user_on_teams`, `teams_check_in` and `notify_teams`, guided by your instructions file. | Yes. The model decides when to call them. |
| **Hooks** (`hooks/teams-hook.mjs`) | **PreToolUse** holds gated tools (by default, terminal commands) until you tap Allow, Deny or Stop agent. **Stop** asks "Done or Continue?" when the agent finishes, and anything you type becomes its next instruction. | No. VS Code enforces them. |

The hooks only act while **away mode** is on, so nothing changes while you're at your desk.

## Requirements

- Windows, macOS or Linux PC with **Node.js 18.18+** and **VS Code** with GitHub Copilot (agent mode).
- Microsoft Teams on your phone, and Power Automate in your work account. Flow A needs a Premium connector; see the [setup guide](docs/SETUP-POWER-AUTOMATE.md).

## Quick start

```bash
git clone <this repo> C:\tools\teams-agent-bridge      # any folder
cd C:\tools\teams-agent-bridge
npm install
npm run setup          # creates .env, installs the hook, prints the MCP config
```

1. **Build the flows.** Follow [docs/SETUP-POWER-AUTOMATE.md](docs/SETUP-POWER-AUTOMATE.md), which takes about 10 minutes, then paste the URLs into `.env`.
2. **Test the connection.** Run `npm run test:ask`, tap a button on your phone, and check that the terminal prints your answer.
3. **Add the MCP server to VS Code.** Open the Command Palette with `Ctrl+Shift+P`, run **MCP: Open User Configuration**, and merge in the block that `npm run setup` printed (also saved to `generated/mcp.json`). Start the `teamsBridge` server when VS Code asks.
4. **Teach the agent.** Copy [`templates/copilot-instructions.md`](templates/copilot-instructions.md) into your project as `.github/copilot-instructions.md`, or append it to the existing file.
5. **Check the hook.** In VS Code, run **Chat: Configure Hooks** and confirm `~/.copilot/hooks/teams-agent-bridge.json` is listed.

## Daily use

```bash
npm run away     # leaving your desk → approvals and "finished?" prompts go to Teams
npm run back     # back at your desk → hooks go idle
npm run status   # show current mode and settings
```

From your phone you can do the following:

| Card | Buttons | Typing in the text box… |
|---|---|---|
| ⚠️ Approve agent action? | **Allow** / **Deny** / **Stop agent** | Deny + text: the text is given to the agent as the reason. Use it to suggest a different command. |
| 📋 Check-in | **Continue** / **Change plan** / **Stop** | becomes the agent's new instruction |
| ✅ Agent finished | **Done** / **Continue** | Continue + text: the agent keeps working on what you typed |

**Tip:** start long tasks in VS Code with something like *"…work through this; check in on Teams after each step"*, then run `npm run away`.

## Configuration (`.env`)

| Key | Default | Meaning |
|---|---|---|
| `TEAMS_ASK_FLOW_URL` | (none, required) | Flow A HTTP URL |
| `TEAMS_NOTIFY_WEBHOOK_URL` | (none) | Flow B webhook, used for one-way updates |
| `TEAMS_TIMEOUT_MINUTES` | `30` | How long to wait for you |
| `TEAMS_GATE_TOOLS` | `run_in_terminal` | Regex of tool names that need approval. `.*` means every tool. |
| `TEAMS_ON_TIMEOUT` | `deny` | What a gated tool does if you don't answer |
| `TEAMS_STOP_HOOK` | `ask` | `ask` / `notify` / `off` when the agent finishes |
| `TEAMS_REQUIRE_AWAY_FLAG` | `true` | If `false`, hooks always route to Teams |
| `TEAMS_HOOK_ENABLED` | `true` | Master switch for the hooks |

To find exact tool names to gate, open the agent debug logs (Chat view, then **⋯**, then **Show Agent Debug Logs**) while the agent runs.

## Important notes

- **Session target.** The hook file uses the format of VS Code's **Local** agent harness, which is the default Copilot agent in the Chat view. If you switch the session target to *Copilot CLI / Agent Host*, *Claude* or *Codex*, those harnesses use different hook formats and these hooks may not fire. The MCP tools still work everywhere.
- **Keep the PC awake.** It must stay on and unlocked, or at least not sleeping, with VS Code open. Check your company's power policy.
- **On-screen prompts.** VS Code's own approval prompts can't be answered from Teams. Either enable auto-approve for the tools you're comfortable with and let the hook be your gate, or gate those same tools with `TEAMS_GATE_TOOLS`.
- **Security.**
  - The flow URLs are secrets; `.env` is git-ignored, so keep it that way.
  - The bridge only makes outbound HTTPS calls and opens no ports.
  - If Teams is unreachable, gated tools are **denied**, never silently allowed.
- **Company policy.** You're installing a hook and an MCP server on a company PC, so check with IT if you're unsure.

## Development

```bash
npm test         # offline end-to-end test (mock flow, 12 checks)
npm run mock     # run a fake flow on localhost:7071 and answer cards in the terminal
```

To try the bridge without Teams, run `npm run mock` in one terminal. Then set these two values in `.env`:

```
TEAMS_ASK_FLOW_URL=http://localhost:7071/ask
TEAMS_NOTIFY_WEBHOOK_URL=http://localhost:7071/notify
```

Use VS Code as normal and answer cards in the mock's terminal by typing, for example, `1 Allow` or `2 Continue now add tests`.

Uninstall the hook with `npm run setup -- --uninstall`.

## Files

```
src/server.mjs                 MCP server (3 tools)
src/lib.mjs                    config, Adaptive Card builder, Teams calls
hooks/teams-hook.mjs           PreToolUse + Stop hook
scripts/setup.mjs              one-time install
scripts/away.mjs               away / back / status
scripts/test-ask.mjs           send a real test card
scripts/mock-flow.mjs          local fake flow for testing
scripts/self-test.mjs          automated tests
flow/                          trigger schema + sample card
docs/SETUP-POWER-AUTOMATE.md   step-by-step flow setup
templates/copilot-instructions.md
```
