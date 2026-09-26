# genie

Write a task, and genie plans it, builds it with Claude Code on a pilots
machine, opens a pull request with a live preview, and ships it when you
approve. genie is itself a WebJs app with one SQLite file, and it doubles as a
headless GitHub Projects board: every card it moves is mirrored to the board,
and every card a human moves on the board is a verdict genie acts on.

## The loop

```
you              genie (WebJs + SQLite)       pilots machine                GitHub + pilots GitHub App
create task      Todo to Plan                 fork the base checkpoint,     issue with the genie label,
                                              clone, write PLAN.md          board card, plan comment
                 Plan to In Progress          branch, build, run the        PR opened, self-review fixes
                                              project's tests, push,        and comments on the PR,
                                              self-review the PR            preview URL comment
                 In Progress to Review        (machine idles)               card shows the preview link
request changes  Review to In Progress        revise on the same branch,    same PR, new commit,
                                              push                          preview rebuilt
approve          Review to Done               (machine swept later)         PR squash-merged,
                                                                            production deploys
```

The board columns are Todo, Plan, In Progress, Review and Done. genie owns
the middle three. You own Todo and the verdict on Review, and you can give
that verdict three ways: the buttons on the card, moving the card on the
GitHub board, or a pull request review that requests changes or approves.
A failed stage keeps its column, shows the error on the card, and Retry
re-runs that stage on the same machine.

## Quickstart, local

You need:

- Node 24 or newer.
- `gh auth login` with the `repo` and `project` scopes, or a fine-grained
  token with Issues, Pull requests and Projects read and write on the repos
  you connect. genie checks the scopes when it first talks to GitHub and shows
  the failure on the project page.
- `pilot login`, and an API key for the same pilots team in `PILOT_API_KEY`.
  A key is shown once when it is minted; genie names every machine it creates
  with the `genie-` prefix, so a key restricted to that prefix works.
- `claude setup-token` on a Claude Max subscription. The token it prints goes
  in `CLAUDE_CODE_OAUTH_TOKEN`.

Then:

```sh
git clone git@github.com:vivek7405/genie.git
cd genie
cp .env.example .env      # fill PILOT_API_KEY, CLAUDE_CODE_OAUTH_TOKEN, GH_TOKEN
npm install
npm run dev
```

Open http://localhost:8080, go to the dashboard, and connect a repository as
`owner/name` with the number of its Project board. The board's Status field
gains the Plan and Review options if it lacks them.

`npm run ci` runs every gate (conventions, health, types, audit, server,
browser and end-to-end tests) and is the same command the GitHub workflow
runs.

## Deploy on pilots

`compose.pilots.yaml` is the pilots shape, and `pilot deploy` picks it ahead
of `compose.yaml`. It keeps one replica resident (the worker and the GitHub
sync poll with nobody connected, so the replica must not suspend) and puts
the SQLite file on the `genie-data` volume at `/data`, where it survives
every redeploy. The three credentials are `secret://` references. Set them
once, in the genie directory, and the values never touch the repo:

```sh
pilot secret set pilot_api_key
pilot secret set claude_code_oauth_token
pilot secret set github_token
pilot deploy
pilot service info genie
```

The last line prints the URL and the replica id. The deploy is healthy when
`/__webjs/ready` answers 200, which also proves the migration ran against the
volume (`readiness.ts` reads the settings table on every probe).

`compose.yaml` is for a laptop: `docker compose up --build` runs the same
image with a host port mapping and a local volume.

## Set up a target repo

Any repository pilots already deploys can be a target. The demo target is
`vivek7405/genie-demo`, a small WebJs app called Lumen with a home page and a
pricing page and no `/about` route, because that is the task the demo adds.
Create it with the same steps you would use for your own repo:

```sh
cd ~/Documents/Projects
npm create webjs@latest genie-demo -- --db sqlite --runtime node
cd genie-demo
npm run gallery:clear && npm run db:generate && npm run db:migrate
# replace app/page.ts with the landing page, add app/pricing/page.ts, npm run ci
gh repo create vivek7405/genie-demo --public --source . --push --description "Demo target for genie"
gh label create genie --repo vivek7405/genie-demo --color 7c3aed --description "Automated by genie"
gh project create --owner vivek7405 --title genie-demo --format json   # note the number
gh project link <number> --owner vivek7405 --repo vivek7405/genie-demo
pilot deploy                                                           # creates the service genie-demo
pilot repo connect vivek7405/genie-demo genie-demo
pilot repo show genie-demo                                             # deploys under ON PUSH, yes under APP INSTALLED
```

Generalized: the repo needs the `genie` label, a Project board linked to it,
one `pilot deploy` from a checkout so the service exists, and
`pilot repo connect <owner/name> <service>`. If the pilots GitHub App is not
installed on the owner yet, the connect command opens the consent screen.
From then on the app builds every pull request, posts a comment starting
`Preview for` with the preview URL, sets a "preview ready" commit status,
destroys the preview when the PR closes, and deploys `main` on every push.
genie only reads those signals. It never deploys anything itself.

To check the wiring once by hand:

```sh
git checkout -b smoke && git commit --allow-empty -m "Smoke preview" && git push -u origin smoke
gh pr create --fill          # wait for the preview comment and the "preview ready" status
gh pr close --delete-branch
```

## End-to-end demo walkthrough

1. On the dashboard, connect `vivek7405/genie-demo` with its board number.
   The project header links the production URL once pilots reports the
   service.
2. Create the task "Add a /about page with team list". The card appears in
   Todo with its issue number, and the issue on GitHub carries the `genie`
   label and a card on the board.
3. Within a tick the card moves to Plan. A machine is forked from the base
   checkpoint and the repo is cloned. When planning finishes, the plan is
   posted as a comment on the issue, with the stack it chose on its first
   line, and the card moves to In Progress.
4. Watch the card's activity feed: a branch, a build, the project's tests,
   a push, then "PR opened" with the PR link, then the self-review line with
   the number of findings it fixed and comments it left, then the pilots
   preview comment landing on the PR.
5. The card moves to Review and shows the preview link. Open it: the about
   page is live on the preview machine.
6. Press Request changes with "make it dark mode". The card returns to In
   Progress, the same branch gets a new commit, the same PR gets a new
   preview, and the card comes back to Review. Open the preview again.
7. Press Approve. The PR is squash-merged, the branch is deleted, pilots
   deploys `main`, and the production URL on the project header now serves
   the about page. The card is in Done and the issue is closed.
8. To run it again:

   ```sh
   npm run demo:reset -- --yes --github
   ```

   That deletes the demo project's tasks and their events, keeps the project
   row, and closes the open genie-labeled PRs and issues on the repo. Without
   `--yes` it only reports. Against the deployed genie:

   ```sh
   pilot exec <replica id> -- sh -c 'cd /app && node scripts/demo-reset.ts --yes --github'
   ```

## Environment variables

Every variable in `.env.example`. The scaffold ones are inherited from
create-webjs and genie does not use them.

| Variable | Meaning |
| --- | --- |
| `PORT` | The port the server listens on. 8080 by default, and on pilots. |
| `DATABASE_URL` | The SQLite file, `file:./db/dev.db` locally and `file:/data/genie.db` on pilots. |
| `PILOT_API_KEY` | pilots API key for creating and driving task machines. |
| `PILOT_API_URL` | Optional. Points at a self-hosted pilots fleet. |
| `CLAUDE_CODE_OAUTH_TOKEN` | Subscription token from `claude setup-token`, passed to Claude Code inside the machine. |
| `GH_TOKEN` | GitHub token for the repo and its Project board. Falls back to `gh auth token` when unset. |
| `GENIE_WORKER` | `0` boots the UI without the pipeline worker. Tests do. |
| `GENIE_CONCURRENCY` | How many tasks the worker drives at once. Keep 1 on a subscription token. |
| `GENIE_TICK_MS` | Worker poll interval. |
| `GENIE_SYNC` | `0` boots without the GitHub sync loop. |
| `GENIE_SYNC_MS` | GitHub poll interval, 30 s by default. |
| `GENIE_SELF_REVIEW` | `0` skips the self-review after the PR is opened. |
| `GENIE_BUILD_TIMEOUT_MS` | Budget for one build run, 45 minutes by default. |
| `GENIE_PREVIEW_TIMEOUT_MS` | How long to wait for a pilots preview before serving from the task machine. |
| `GENIE_PILOTS_FORK` | `0` builds every task machine from scratch instead of forking the base checkpoint. |
| `GENIE_MAX_ATTEMPTS` | Retries of a stage before it stays failed. |
| `GENIE_DRAIN_MS` | How long a SIGTERM waits for in-flight stages, 8 s by default. |
| `GENIE_CLEANUP_DAYS` | Age after which the cleanup script destroys a failed task's machine. |
| `GENIE_STUB_STEP_MS` | How long each stub stage pretends to work. Only while the pipeline is stubbed. |
| `AUTH_SECRET`, `AUTH_*_ID`, `AUTH_*_SECRET`, `REDIS_URL` | Scaffold defaults, unused by genie. |

The pilots secrets `pilot_api_key`, `claude_code_oauth_token` and
`github_token` map onto `PILOT_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN` and
`GH_TOKEN`.

## Operating Genie

- `GET /health` answers JSON: the worker loop (enabled, stopping, last tick
  and its error, the tasks running), the GitHub sync state, and how many
  tasks are claimed, deferred and failed. It answers 503 when the worker is
  enabled but has not ticked for five intervals, so a probe sees a wedged
  loop.
- A restart never loses a task. On boot the worker releases every claim the
  previous process left (on Pilots a redeploy is a power cut, no signal
  reaches the guest), writes "Interrupted by a restart" on the card, and
  re-claims the task on its first tick. Where SIGTERM does arrive (compose,
  `npm run dev`) the worker drains for `GENIE_DRAIN_MS` first, then releases
  what is still running the same way.
- A Claude rate limit is a wait, not a failure. The card shows "Waiting" with
  "Waiting for Claude quota, retrying at HH:MM" and the worker tries again 5,
  15, 30, then 60 minutes later, or a minute after the reset instant Claude
  reports. A stage that crashes `GENIE_MAX_ATTEMPTS` times (3) ends in a red
  card instead of a loop; Retry starts the count over.
- At most one task per project runs at once, whatever `GENIE_CONCURRENCY`
  says, so two tasks never push against the same repository together.
- `npm run cleanup:machines` lists every Pilots machine with a decision and
  destroys nothing; `npm run cleanup:machines -- --yes` destroys the machine
  of a task that is done, of a task that failed more than `GENIE_CLEANUP_DAYS`
  (3) days ago, and any `genie-` machine that old which no task knows. It
  never destroys `genie-base` or a machine that is not genie's. Run it daily
  from a Pilots schedule.

## Limitations

- One replica by design. A volume is mounted by one machine, and SQLite has
  one writer.
- GitHub is polled every 30 s, so a board move or a PR review takes up to
  that long to show.
- One task at a time on a subscription token. A rate limit defers the task
  and shows a Waiting badge until the limit resets.
- A redeploy on pilots is a power cut for the running process. The SIGTERM
  drain runs only under docker compose or `npm run dev`, so a task mid-stage
  during a deploy is resumed by the next boot rather than finished, on the
  same branch and PR.
- Preview machines of the demo repo hold their SQLite file in the rootfs, so
  each preview starts empty.
- No auth on genie itself. Keep it on a private URL, or do not expose it
  beyond the demo.
- `GET /health` reports the worker and sync state as JSON for anyone checking
  on the deployed instance. The deploy gate stays `/__webjs/ready`.

## Status

Merged today: M1 (dashboard, board, stub pipeline) with the brand and the
public site. This branch adds M7 (the pilots compose file, the readiness
gate, the demo reset, this README). In progress: M2 (GitHub sync and the board mirror),
M3 (pilots machines and the Claude launcher), M4 (the real plan and build
stages with the self-review), M5 (approve, request changes, production URL),
M6 (hardening, the cleanup script, `GET /health`). Until they merge, the
pipeline is the M1 stub and the sections above describe the plan of record.
