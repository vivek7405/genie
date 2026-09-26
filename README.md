# genie

Async project manager: write a task, genie plans it, builds it with webjs and ships it on pilots for review.

## Operating genie

- `GET /health` answers JSON: the worker loop (enabled, stopping, last tick
  and its error, the tasks running), the GitHub sync state, and how many
  tasks are claimed, deferred and failed. It answers 503 when the worker is
  enabled but has not ticked for five intervals, so a probe sees a wedged
  loop.
- A restart never loses a task. On boot the worker releases every claim the
  previous process left (on pilots a redeploy is a power cut, no signal
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
- `npm run cleanup:machines` lists every pilots machine with a decision and
  destroys nothing; `npm run cleanup:machines -- --yes` destroys the machine
  of a task that is done, of a task that failed more than `GENIE_CLEANUP_DAYS`
  (3) days ago, and any `genie-` machine that old which no task knows. It
  never destroys `genie-base` or a machine that is not genie's. Run it daily
  from a pilots schedule.
