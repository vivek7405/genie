# genie on pilots

genie runs every task inside its own pilots machine: a microVM with Claude
Code signed in for one process, the task's repository cloned, and nothing of
yours to wreck. This page is the operator's view of that layer. The code is
under `modules/pipeline/` (`pilots.server.ts`, `claude.server.ts`,
`git.server.ts`, `base-image.server.ts`).

## The base machine

`genie-base` is a machine built once with git, gh, Claude Code, `create-webjs`
and `webjsdev` installed, 2048 MiB of memory, and a git identity of
`genie <genie@users.noreply.github.com>`. It is checkpointed, and the
checkpoint id is stored in the `settings` table under `base_checkpoint_id`.
Every task machine is a fork of that checkpoint, so it comes up ready in
seconds instead of paying the installs per task.

The base machine is never destroyed. Destroying a machine on pilots deletes
its checkpoints, and a fork needs the checkpoint's machine to exist. Suspended
between tasks, it costs nothing. Cleanup code must skip it: it carries the
label `genie_base=1` and the name `genie-base`, and either is reason enough
to leave it alone.

To rebuild it (a newer Claude Code, a broken checkpoint):

```sh
npm run pilots:smoke -- --rebuild-base
```

That clears the stored id, destroys `genie-base`, builds it again and then
runs the rest of the smoke. If the stored checkpoint goes missing on its own,
the next task rebuilds the base once and carries on.

## Task machines

A task machine is named `genie-<slug>-<id8>`: `genie-`, the repository name
lowercased with every run of characters outside `[a-z0-9]` collapsed to one
hyphen and cut to 40 characters, a hyphen, and the first 8 characters of the
task id. `vivek7405/genie` with task `2f7c9d3e-...` is `genie-genie-2f7c9d3e`.
The name is the discovery key: a retry after a crash finds and reuses the
machine it already had instead of forking a second one. A fork carries no
labels and no knobs, so `tasks.machineId` and `tasks.machineName` are what a
cleanup joins against.

The default org quota is 20 machines: the base plus at most 19 task machines.
When the fleet refuses a fork, the task fails with `pilots machine quota
reached (20). Destroy finished task machines and retry.` and the card shows
it. Machine cleanup arrives with M6.

`GENIE_PILOTS_FORK=0` builds every task machine from scratch (a plain create,
a resize to 2048 MiB, and one launcher run to install Claude Code) instead of
forking. It is slower and exists for debugging the base image.

## Where secrets travel, and where they never go

Three credentials are involved: `PILOT_API_KEY` (this server talks to the
fleet with it, and it never enters a machine), `CLAUDE_CODE_OAUTH_TOKEN` (a
subscription token from `claude setup-token`), and `GH_TOKEN` (a fine-grained
GitHub token for the connected repos).

The Claude and GitHub tokens reach a machine only as the `env` of one
buffered exec, the way `pilot claude` forwards a login. The launcher installs
Claude Code the first time and then `exec`s it, so the token lives in that one
process's environment and is written to no file in the machine. git gets the
GitHub token the same way, as a `GIT_CONFIG_*` insteadOf rewrite in the exec's
env, never in a `.git/config`. Nothing is ever passed on the exec stream
(that route carries env in the URL) and nothing is granted through the pilots
secrets broker (a granted secret is readable by anything in the guest for the
machine's whole life).

Everything that comes back is redacted before it is recorded: `execLong`
blanks the values of the env it sent from stdout and stderr, and
`recordEvent` and `failStage` pass every line through `redact()`, which
replaces the known token values with `[redacted]`. git prints a rewritten
remote URL on error and gh echoes a token in a 401, which is exactly the text
that ends up in a failed stage's message.

What this does not cover: the process can read its own environment, and so
can anything Claude Code runs. While a run is in progress the token is in the
machine's memory, so a checkpoint or fork taken then would carry it. The base
checkpoint is taken with no token in any process.

## The smoke script

```sh
cp .env.example .env    # fill in PILOT_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN
npm run pilots:smoke
npm run pilots:smoke -- --repo owner/name --keep
```

It builds or verifies the base, forks a task machine, clones the repo, asks
Claude to write `HELLO.md`, reads it back, pushes a `genie/smoke-<ts>` branch,
pulls `/home/pilot/.genie` out of the machine, destroys the machine (unless
`--keep`) and prints a timing table. The first failure stops it and leaves the
machine alive with its name printed, so it can be inspected with `pilot
machine exec <name> -- bash`. The pushed branch is yours to delete afterwards;
the script prints the command.

It is manual and is not part of `npm run ci`, which stays green with none of
the three variables set.
