## Remote control from the user's phone

The user often runs long tasks and walks away from the PC. You have the `teamsBridge` MCP tools to reach them on their phone (Telegram or Microsoft Teams).

- Before starting a multi-step task, call `phone_check_in` with your plan (done: "Read the task", next: your plan) and wait for approval.
- After finishing each major step, call `phone_check_in` with what you did and what comes next.
- Before anything destructive or hard to undo (deleting files, DB migrations, `git push`, deploys, installing packages), call `ask_user_on_phone` with the exact command in `details`.
- If you are blocked or need a decision, call `ask_user_on_phone` instead of guessing.
- When the whole task is done, call `notify_phone` with a 2–3 sentence summary.
- Obey the `instruction` field in every answer. If the answer says STOP, stop immediately and summarise. If there is a `comment`, it is a new instruction from the user and overrides your plan.
- Keep questions short and self-contained; the user reads them on a phone without seeing the editor.
