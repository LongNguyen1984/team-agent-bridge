# Power Automate setup

You build two flows. **Flow A** is required: it posts a card with buttons to Teams and waits for your tap. **Flow B** is optional: it handles one-way notifications.

Both flows run in your own Microsoft 365 account. Nothing on your PC is opened to the internet. The PC only makes outgoing HTTPS calls to Power Automate.

> **License note.** Flow A uses the *When an HTTP request is received* trigger, which is a **Premium** connector. It needs a Power Automate Premium (per-user or per-flow) license, or a plan your company already provides. Flow B uses the Teams Workflows webhook and normally needs no Premium license. If your tenant blocks the HTTP trigger, see *Alternatives* at the bottom.

---

## Flow A: "Agent – ask me" (required)

Go to <https://make.powerautomate.com>, then select **Create**, then **Instant cloud flow**, then **Skip**, and build these three steps.

### 1. Trigger: *When an HTTP request is received*

| Setting | Value |
|---|---|
| Who can trigger the flow | **Anyone**. The secret `sig=` in the URL is the protection, so keep the URL private. |
| Request Body JSON Schema | paste the contents of [`flow/http-trigger-schema.json`](../flow/http-trigger-schema.json) |
| Method | POST |

### 2. Action: Microsoft Teams, *Post card in a chat or channel and wait for a response*

The action may be called *Post adaptive card and wait for a response*, depending on your version.

| Field | Value |
|---|---|
| Post as | **Flow bot** |
| Post in | **Chat with Flow bot** |
| Recipient | your work email |
| Message (Adaptive Card) | dynamic content **`card`** from the trigger |
| Update message | `✔ Sent to the agent` |
| Should update card | **Yes** |

The PC builds the whole card, including the buttons and a text box, and sends it in the `card` field. You never have to edit the card in the flow. [`flow/sample-card.json`](../flow/sample-card.json) shows what the PC sends; you can paste it into <https://adaptivecards.io/designer> to preview it.

Optional: open **⋯**, then **Settings**, then **Timeout**, and set it to match `TEAMS_TIMEOUT_MINUTES`. For example, `PT30M` means 30 minutes.

### 3. Action: *Response*

| Field | Value |
|---|---|
| Status Code | `200` |
| Headers | `Content-Type` : `application/json` |
| Body | **Expression**: `body('Post_card_in_a_chat_or_channel_and_wait_for_a_response')` |

Adjust the name in `body('…')` to match your step 2 action, with spaces replaced by `_`. You can also pick the whole body from Dynamic content. The bridge reads `submitActionId` (which button you tapped) and `data.comment` (what you typed) from it.

**Important:** open the Response action's **⋯**, then **Settings**, and turn **Asynchronous response ON**. Without it, the HTTP call times out after about 2 minutes. With it, Power Automate immediately replies `202 Accepted` with a status URL, and the bridge polls that URL until you answer.

### 4. Save and copy the URL

Save the flow, open the trigger again, and copy the **HTTP URL** into `.env`:

```
TEAMS_ASK_FLOW_URL=https://...logic.azure.com/workflows/.../triggers/manual/paths/invoke?api-version=...&sig=...
```

Test it from the repo folder with `npm run test:ask`. A card should appear in your **Workflows** chat in Teams, on both PC and phone. Tap a button, and the terminal prints your answer.

---

## Flow B: "Agent – notify me" (optional, one-way)

1. In Teams, open **Apps**, then **Workflows**, and choose the template **"Send webhook alerts to a chat"**. It may be called *Post to a chat when a webhook request is received*.
2. Choose the chat (for example, *Chat with Flow bot*, or a group chat containing only you), then **Save**.
3. Copy the webhook URL it shows into `.env`:

```
TEAMS_NOTIFY_WEBHOOK_URL=https://...
```

Test it with `npm run test:notify`.

---

## Make sure your phone gets the notifications

- In Teams mobile, go to **Settings**, then **Notifications**, and turn on chat notifications.
- Pin the **Workflows** chat so you can find agent cards quickly.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Flow timed out (502/504)` | Asynchronous response is OFF in the Response action. Turn it ON. |
| `HTTP 401/403` | The trigger is set to "Any user in my tenant" or "Specific users". Change it to **Anyone**, or ask IT for an exception. |
| Card appears but the PC never gets the answer | Open the flow's **Run history**. If step 3 failed, the `body('…')` name is wrong. |
| Buttons do nothing on mobile | Make sure the card is posted by **Flow bot**, not *User*. Only Flow bot cards can be answered. |
| `HTTP 202` loops then times out | You didn't answer within `TEAMS_TIMEOUT_MINUTES`. Raise it, and also raise the action timeout in step 2. |

## Alternatives if the HTTP trigger is blocked

- **Microsoft Graph API.** Register an Entra ID app with `Chat.ReadWrite` and post and read chat messages directly. This needs admin consent from IT.
- **A personal Microsoft account** with its own Power Automate trial. Check your company's policy before doing this.
