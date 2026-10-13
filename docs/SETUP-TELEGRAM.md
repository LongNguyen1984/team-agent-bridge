# Telegram setup (free, about 5 minutes)

Telegram is **only on your phone**. Nothing is installed on the PC except this repo. The bridge talks to Telegram's servers over normal HTTPS, so the PC only needs to reach `https://api.telegram.org`.

## 1. Create your bot (on the phone)

1. Install **Telegram** on your phone and sign in.
2. Search for **@BotFather** (the official one, with a blue check mark) and tap **Start**.
3. Send `/newbot`.
4. Give it a display name, for example `My Copilot Bridge`.
5. Give it a username ending in `bot`, for example `longnmh_copilot_bot`. It must be unique.
6. BotFather replies with a **token** like `8123456789:AAH...`. This token is a password for your bot, so don't share it or commit it.

## 2. Link the bot to this PC

In the repo folder:

```bash
npm run telegram:setup
```

1. Paste the token when asked.
2. When it says *"search for @your_bot, tap START"*, do that on your phone.
3. The script saves `BRIDGE_CHANNEL=telegram`, `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` to `.env`, and the bot sends you *"✅ Connected"*.

**Only your chat can answer.** Messages and button taps from anyone else are ignored.

## 3. Test

```bash
npm run test:ask
```

You get a message with **Continue / Stop** buttons. Tap one, or reply to the message with some text. The terminal prints what you did.

`npm run test:notify` sends a one-way message.

## How you answer on the phone

| You do | The agent gets |
|---|---|
| Tap a button | That choice, e.g. Allow / Deny / Stop agent / Continue |
| **Reply** to the question with text (swipe left on the message, or long-press then Reply) | Your text as a new instruction |
| Send plain text, without replying | Treated as a reply to the **newest** waiting question |

What a text answer means depends on the question:

| Question | Text answer means |
|---|---|
| ⚠️ Approve agent action? | **Deny**, and do what I wrote instead |
| ✅ Agent finished | **Continue** working on what I wrote |
| 📋 Check-in | **Change plan** to what I wrote |

After you answer, the message is updated with ✅ and your choice, so you can see what was sent.

## Troubleshooting

| Problem | Fix |
|---|---|
| `Could not reach Telegram` | Open https://api.telegram.org in the PC's browser. If it's blocked, the company network doesn't allow Telegram. If your company uses a proxy, set `HTTPS_PROXY=http://proxy:port` in `.env`. |
| `409 Conflict` | Another program is using the same bot token. Use this bot only for the bridge. |
| No message arrives | Check that `TELEGRAM_CHAT_ID` in `.env` is your chat. Run `npm run telegram:setup` again. |
| "No question from the agent is waiting right now" | You replied after the question timed out or was already answered. |
| Want to switch back to Teams | Set `BRIDGE_CHANNEL=teams` in `.env`. |

## Privacy note

The agent's questions travel through Telegram's servers. They usually contain the commands it wants to run and short status summaries, but the agent decides what to write, so they could include code snippets or error messages. Check that this is acceptable under your company's policy before using it for work projects.
