# Genie

Connect a GitHub repo, add a task to the backlog, and let AI take care of the rest.

Genie is a kanban board with one worker on it. Each task gets its own
[Pilots](https://pilotrun.app) machine, where Claude Code plans it, builds it, runs
the repository's own checks and opens a pull request. You review, then approve or
ask for changes.

| Column | Who owns it | What happens |
| --- | --- | --- |
| Backlog | Genie | A machine starts and clones the repository |
| In progress | Genie | Claude builds on a branch and opens the pull request |
| Review | You | Approve and merge, or request changes |
| Done | | Squash merged, branch deleted, machine destroyed |

A failed stage stays in its column and shows why, and Retry runs it again. Stop ends
a queued or running task, and any idle card short of Done can be removed.

## Run it locally

You need [Bun](https://bun.sh), and these in `.env` (`cp .env.example .env`):

| Variable | What it is |
| --- | --- |
| `AUTH_SECRET` | Signs the session cookie. 32 or more random characters. |
| `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | The OAuth client of a GitHub App, with the callback `<origin>/api/auth/callback/github`. |
| `GH_TOKEN` | Acts on your repositories (`repo` scope). Only the owner of this token can sign in. |
| `PILOT_API_KEY` | Runs the machines. |
| `CLAUDE_CODE_OAUTH_TOKEN` | From `claude setup-token`. |

```sh
bun install
bun --bun run dev   # migrates, then serves on PORT (default 8080)
```

The first task also builds a `genie-base` Pilots template, so later machines start
with git, gh and Claude Code already installed.

## How it fits together

- `modules/pipeline/worker.server.ts` is the job runner. The `tasks` table is the
  queue, with one task per repository at a time. A restart resumes what it interrupted.
- `modules/pipeline/stages.server.ts` is what each column does.
- `modules/pipeline/pilots.server.ts` is the rule for secrets: a credential reaches a
  machine only as the env of one exec, and everything coming back is redacted.
- The board and the activity feed update live over `/ws`.

Genie is single tenant on purpose: every repository call acts as the owner of
`GH_TOKEN`, so nobody else can sign in.

`bun run ci` runs every gate. `AGENTS.md` is the framework contract for this repo.
