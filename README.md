# teams-agent-bridge

Control the **GitHub Copilot agent running in VS Code on your PC** from **your phone**: approve commands, give it new instructions, or stop it, without going back to your desk.

Two phone channels are supported:

| Channel | Cost | On the PC | Answer with |
|---|---|---|---|
| **Telegram** (recommended) | Free | Nothing extra, just HTTPS to `api.telegram.org` | Buttons, or reply with text |
| **Microsoft Teams** | Needs Power Automate **Premium** | Nothing extra, just HTTPS to Power Automate | Card buttons + text box |

```
 VS Code on your PC                                             Your phone
┌──────────────────────────┐   HTTPS out    ┌──────────────┐   ┌────────────────────────┐
│ Copilot agent            │───────────────▶│ Telegram API │──▶│ ⚠️ Approve agent action? │
│  ├─ MCP tools  ──────────┤                │  or Teams    │   │ $ npm run db:migrate    │
│  └─ hooks (enforced) ────┤◀───────────────│              │◀──│ [Allow] [Deny] [Stop]   │
└──────────────────────────┘  polls answer  └──────────────┘   └────────────────────────┘
```

There are two layers. You can use either one, or both.

| Layer | What it does | Can the model skip it? |
|---|---|---|
| **MCP tools** (`src/server.mjs`) | The agent can call `ask_user_on_phone`, `phone_check_in` and `notify_phone`, guided by your instructions file. | Yes. The model decides when to call them. |
| **Hooks** (`hooks/teams-hook.mjs`) | **PreToolUse** holds gated tools (by default, terminal commands) until you tap Allow, Deny or Stop agent. **Stop** asks "Done or continue?" when the agent finishes, and anything you send becomes its next instruction. | No. VS Code enforces them. |

The hooks only act while **away mode** is on, so nothing changes while you're at your desk.

## Requirements

- Windows, macOS or Linux with **Node.js 18.18+** and **VS Code** with GitHub Copilot (agent mode).
- Telegram on your phone, **or** Microsoft Teams with Power Automate Premium.

## Quick start (Telegram)

```bash
git clone https://github.com/LongNguyen1984/team-agent-bridge.git
cd team-agent-bridge
npm install
npm run setup             # creates .env, installs the hook, prints the MCP config
npm run telegram:setup    # paste your bot token, tap START in Telegram
npm run test:ask          # tap a button on your phone
```

To create a bot, see [docs/SETUP-TELEGRAM.md](docs/SETUP-TELEGRAM.md); you message @BotFather and send `/newbot`. For Teams, see [docs/SETUP-POWER-AUTOMATE.md](docs/SETUP-POWER-AUTOMATE.md).

Then, in VS Code:

1. **Add the MCP server.** Open the Command Palette with `Ctrl+Shift+P`, run **MCP: Open User Configuration**, and merge in the block that `npm run setup` printed (also saved to `generated/mcp.json`). Start the `teamsBridge` server when VS Code asks.
2. **Teach the agent.** Copy [`templates/copilot-instructions.md`](templates/copilot-instructions.md) into your project as `.github/copilot-instructions.md`, or append it to the existing file.
3. **Check the hook.** Run **Chat: Configure Hooks** and confirm `~/.copilot/hooks/teams-agent-bridge.json` is listed.

## Daily use

```bash
npm run away     # leaving your desk → approvals and "finished?" prompts go to your phone
npm run back     # back at your desk → hooks go idle
npm run status   # show current mode and settings
```

| Message on your phone | Buttons | If you answer with text |
|---|---|---|
| ⚠️ Approve agent action? | **Allow** / **Deny** / **Stop agent** | Deny, and the agent does what you wrote instead |
| 📋 Check-in | **Continue** / **Change plan** / **Stop** | becomes the agent's new plan |
| ✅ Agent finished | **Done** / **Continue** | the agent keeps working on what you wrote |

**Tip:** start long tasks in VS Code with something like *"…work through this; check in on my phone after each step"*, then run `npm run away`.

## Configuration (`.env`)

| Key | Default | Meaning |
|---|---|---|
| `BRIDGE_CHANNEL` | auto | `telegram` or `teams` |
| `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` | (none) | Filled in by `npm run telegram:setup` |
| `TEAMS_ASK_FLOW_URL`, `TEAMS_NOTIFY_WEBHOOK_URL` | (none) | Power Automate flow URLs (Teams only) |
| `BRIDGE_TIMEOUT_MINUTES` | `30` | How long to wait for you |
| `BRIDGE_GATE_TOOLS` | `run_in_terminal` | Regex of tool names that need approval. `.*` means every tool. |
| `BRIDGE_ON_TIMEOUT` | `deny` | What a gated tool does if you don't answer |
| `BRIDGE_STOP_HOOK` | `ask` | `ask` / `notify` / `off` when the agent finishes |
| `BRIDGE_REQUIRE_AWAY_FLAG` | `true` | If `false`, hooks always route to your phone |
| `HTTPS_PROXY` | (none) | Company proxy, if the PC needs one to reach the internet |

To find exact tool names to gate, open the agent debug logs while the agent runs.

## Important notes

- **Session target.** The hook file uses the format of VS Code's **Local** agent harness, which is the default Copilot agent in the Chat view. If you switch the session target to *Copilot CLI / Agent Host*, *Claude* or *Codex*, those harnesses use different hook formats and these hooks may not fire. The MCP tools still work everywhere.
- **Keep the PC awake.** It must not be sleeping, and VS Code must stay open.
- **On-screen prompts.** VS Code's own approval prompts can't be answered from the phone. Either enable auto-approve for the tools you're comfortable with and let the hook be your gate, or gate those same tools with `BRIDGE_GATE_TOOLS`.
- **Security.**
  - Only your own Telegram chat can answer; anyone else is ignored.
  - Tokens and URLs live in `.env`, which is git-ignored.
  - The bridge opens no ports.
  - If the phone channel is unreachable, gated tools are **denied**, never silently allowed.
- **Company policy.** Messages pass through Telegram's or Microsoft's servers. Check what's allowed before using this on work code.

## Development

```bash
npm test         # offline end-to-end tests (fake Teams flow + fake Telegram API, 21 checks)
npm run mock     # fake Teams flow on localhost:7071; answer cards in the terminal
```

Uninstall the hook with `npm run setup -- --uninstall`.

## Files

```
src/server.mjs                 MCP server (3 tools)
src/lib.mjs                    config, proxy-aware HTTP, ask()/notify() router
src/channels/telegram.mjs      Telegram Bot API channel
src/channels/teams.mjs         Teams / Power Automate channel
hooks/teams-hook.mjs           PreToolUse + Stop hook
scripts/setup.mjs              one-time install
scripts/telegram-setup.mjs     link your Telegram bot
scripts/away.mjs               away / back / status
scripts/test-ask.mjs           send a real test question
scripts/mock-*.mjs, self-test.mjs   offline tests
docs/                          Telegram and Power Automate setup guides
templates/copilot-instructions.md
```
