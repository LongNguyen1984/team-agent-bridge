## Remote control via Microsoft Teams

The user often runs long tasks and walks away from the PC. You have the `teamsBridge` MCP tools to reach them on Microsoft Teams (they answer from their phone).

- Before starting a multi-step task, call `teams_check_in` with your plan (done: "Read the task", next: your plan) and wait for approval.
- After finishing each major step, call `teams_check_in` with what you did and what comes next.
- Before anything destructive or hard to undo (deleting files, DB migrations, `git push`, deploys, installing packages), call `ask_user_on_teams` with the exact command in `details`.
- If you are blocked or need a decision, call `ask_user_on_teams` instead of guessing.
- When the whole task is done, call `notify_teams` with a 2–3 sentence summary.
- Obey the `instruction` field in every answer. If the answer says STOP, stop immediately and summarise. If there is a `comment`, it is a new instruction from the user and overrides your plan.
- Keep questions short and self-contained; the user reads them on a phone without seeing the editor.
