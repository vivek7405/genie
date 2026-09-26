import { html } from '@webjsdev/core';
import { arrow, box, figure, frame, note } from '#lib/design/diagram.ts';

// The internals page's figures, laid out by hand on explicit grids. Each
// draws one mechanism from the milestone plans; nothing is invented to fill
// a picture. The glow marks one element per figure, as a stroke.

/** Figure: the five columns, and who may move a card between them. */
export function stateFigure() {
  return figure({
    label:
      'Five columns. The worker advances a card from Todo to Plan to In progress to Review. Only a person moves it out of Review, to Done or back to In progress. A failed stage stays in its column with an error set.',
    viewBox: '0 0 920 200',
    minW: 'min-w-[800px]',
    body: html`
      ${box({ x: 20, y: 60, w: 140, h: 56, label: 'Todo' })}
      ${box({ x: 200, y: 60, w: 140, h: 56, label: 'Plan' })}
      ${box({ x: 380, y: 60, w: 140, h: 56, label: 'In progress' })}
      ${box({ x: 560, y: 60, w: 140, h: 56, label: 'Review', tone: 'signal' })}
      ${box({ x: 740, y: 60, w: 140, h: 56, label: 'Done' })}

      ${note({ x: 90, y: 140, text: 'yours', anchor: 'middle', strong: true })}
      ${note({ x: 270, y: 140, text: 'Genie', anchor: 'middle', strong: true })}
      ${note({ x: 450, y: 140, text: 'Genie', anchor: 'middle', strong: true })}
      ${note({ x: 630, y: 140, text: 'Genie, awaiting you', anchor: 'middle', strong: true })}
      ${note({ x: 810, y: 140, text: 'yours', anchor: 'middle', strong: true })}

      ${arrow({ d: 'M 164 88 H 196', label: 'claimed', lx: 180, ly: 52 })}
      ${arrow({ d: 'M 344 88 H 376', label: 'plan posted', lx: 360, ly: 52 })}
      ${arrow({ d: 'M 524 88 H 556', label: 'PR, preview', lx: 540, ly: 52 })}
      ${arrow({ d: 'M 704 88 H 736', label: 'Approve', lx: 720, ly: 52, kind: 'signal' })}
      ${arrow({ d: 'M 630 120 V 170 H 450 V 121', label: 'Request changes', lx: 540, ly: 184, kind: 'signal' })}
      ${arrow({ d: 'M 420 56 V 28 H 480 V 56', label: 'a failure stays here, error set, until Retry', lx: 450, ly: 22, kind: 'dashed' })}
    `,
    caption: html`The system arrows are the only moves the worker may make and each is the successor of the stage
      that just completed. The two accented arrows are the only moves a person may make. Both sets pass
      through one transition function that refuses anything else, so a verdict given on GitHub and a
      button in the dashboard are checked by the same rule.`,
  });
}

/** Figure: one tick of the worker, and the three ways a stage ends. */
export function tickFigure() {
  return figure({
    label:
      'A tick runs the candidate query, claims the oldest row by writing the clock into it, runs its stage, and ends by advancing, failing or deferring the task. A claim older than the stage budget is stale and is claimed again.',
    viewBox: '0 0 920 235',
    minW: 'min-w-[800px]',
    body: html`
      ${box({ x: 20, y: 40, w: 150, h: 48, label: 'tick', sub: 'on a timer, one pass' })}
      ${box({ x: 210, y: 40, w: 220, h: 48, label: 'candidate query', sub: 'system stage, no error, claim free' })}
      ${box({ x: 470, y: 40, w: 170, h: 48, label: 'claim', sub: 'claimed_at now, attempt up', tone: 'signal' })}
      ${box({ x: 680, y: 40, w: 200, h: 48, label: 'runStage', sub: 'ensure machine, plan, build' })}

      ${box({ x: 300, y: 170, w: 180, h: 44, label: 'advance', sub: 'next status, claim cleared' })}
      ${box({ x: 510, y: 170, w: 180, h: 44, label: 'fail', sub: 'error set, column kept' })}
      ${box({ x: 720, y: 170, w: 180, h: 44, label: 'defer', sub: 'deferred_until, then retry' })}

      ${arrow({ d: 'M 174 64 H 206', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 434 64 H 466', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 644 64 H 676', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 555 40 V 24 H 320 V 36', label: 'stale after the stage budget, or failed at the attempt ceiling', lx: 437, ly: 14, kind: 'dashed' })}
      ${note({ x: 320, y: 112, text: 'at most one task per project in flight; concurrency caps the rest', anchor: 'middle' })}

      <path d="M 780 88 V 130" fill="none" stroke="var(--ink-muted)" stroke-width="1.25" />
      ${arrow({ d: 'M 780 130 H 390 V 166', label: 'the stage completes', lx: 390, ly: 158, anchor: 'end' })}
      ${arrow({ d: 'M 780 130 H 600 V 166', label: 'it throws', lx: 600, ly: 158, anchor: 'end' })}
      ${arrow({ d: 'M 780 130 H 810 V 166', label: 'Claude is rate limited', lx: 804, ly: 158, anchor: 'end' })}
    `,
    caption: html`Advancing clears the claim and any deferral, so the next stage claims afresh. Failing keeps the
      status, which is why the card stays in its column with Retry on it. Deferring is the third ending:
      a rate limit from Claude sets a time to try again, one minute after the reset Claude names when it
      names one, else on a backoff that stretches to an hour, and the card says it is waiting rather than
      failed.`,
  });
}

/** Figure: the sync loop, two requests per project per pass. */
export function syncFigure() {
  return figure({
    label:
      'Each pass reads the board items over GraphQL and the open labelled issues over REST, reconciles them against the database, reads pull request reviews for tasks in Review, and writes back through the same transition every move uses.',
    viewBox: '0 0 920 340',
    minW: 'min-w-[820px]',
    body: html`
      ${frame({ x: 20, y: 30, w: 250, h: 280, label: 'GitHub' })}
      ${box({ x: 40, y: 60, w: 210, h: 48, label: 'board items', sub: 'GraphQL, the first hundred' })}
      ${box({ x: 40, y: 124, w: 210, h: 48, label: 'open genie issues', sub: 'REST, pull requests dropped' })}
      ${box({ x: 40, y: 188, w: 210, h: 48, label: 'reviews and comments', sub: 'REST, on the pull request' })}
      ${box({ x: 40, y: 252, w: 210, h: 48, label: 'card moves, comments', sub: 'what Genie writes' })}

      ${frame({ x: 620, y: 30, w: 280, h: 280, label: 'Genie', tone: 'plain' })}
      ${box({ x: 640, y: 60, w: 240, h: 48, label: 'sync pass', sub: 'on a timer, never overlapping' })}
      ${box({ x: 640, y: 124, w: 240, h: 48, label: 'reconcile', sub: 'import, re-assert, read verdicts', tone: 'signal' })}
      ${box({ x: 640, y: 188, w: 240, h: 48, label: 'verdicts', sub: 'approve, requestChanges' })}
      ${box({ x: 640, y: 252, w: 240, h: 48, label: 'transition', sub: 'then mirrorTask, best effort', tone: 'strong' })}

      ${arrow({ d: 'M 254 84 H 440 V 140 H 636', label: 'one query per project, one point', lx: 347, ly: 76 })}
      ${arrow({ d: 'M 254 148 H 636', label: 'one request per project', lx: 300, ly: 140, anchor: 'start' })}
      ${arrow({ d: 'M 254 212 H 636', label: 'one request per task in Review', lx: 445, ly: 204 })}
      ${arrow({ d: 'M 760 172 V 184', label: 'Done, or In progress', lx: 770, ly: 182, anchor: 'start' })}
      ${arrow({ d: 'M 760 236 V 248', label: 'the state machine decides', lx: 770, ly: 246, anchor: 'start' })}
      ${arrow({ d: 'M 636 276 H 254', label: 'move the card, comment at Review and Done', lx: 445, ly: 268 })}
      ${arrow({ d: 'M 636 160 H 600 V 322 H 145 V 304', label: 're-assert a card dragged out of a Genie-owned column', lx: 372, ly: 334, kind: 'dashed' })}
    `,
    caption: html`Labels and bodies are never fetched through GraphQL, whose budget is scored in points from a
      separate pool, so the board query asks for item ids, the status option and the issue number and
      nothing else. A verdict read from the board reaches the same two functions the dashboard buttons
      call. A mirror write that fails becomes an event on the card, and the next pass re-asserts the board.`,
  });
}

/** Figure: the base machine, its checkpoint, and a fork per task. */
export function forkFigure() {
  return figure({
    label:
      'A base machine is created from the Pilots template, provisioned once and checkpointed. Each task machine is a fork of that checkpoint, with the repository cloned into it. A plain create is the fallback when the fork fails.',
    viewBox: '0 0 920 240',
    minW: 'min-w-[800px]',
    body: html`
      ${box({ x: 20, y: 60, w: 150, h: 52, label: 'template', sub: 'Ubuntu, Node, no git', tone: 'sunken' })}
      ${box({ x: 220, y: 60, w: 200, h: 52, label: 'genie-base', sub: 'git, gh, Claude Code, WebJs', tone: 'strong' })}
      ${box({ x: 470, y: 60, w: 170, h: 52, label: 'checkpoint', sub: 'id kept in settings' })}
      ${box({ x: 700, y: 60, w: 200, h: 52, label: 'task machine', sub: 'named by repo and task', tone: 'signal' })}
      ${box({ x: 700, y: 160, w: 200, h: 48, label: 'the repository', sub: 'cloned, or refreshed on a retry' })}

      ${arrow({ d: 'M 174 86 H 216', label: 'create, resize', lx: 195, ly: 52 })}
      ${arrow({ d: 'M 424 86 H 466', label: 'checkpoint', lx: 445, ly: 52 })}
      ${arrow({ d: 'M 644 86 H 696', label: 'fork', lx: 686, ly: 102, kind: 'signal' })}
      ${arrow({ d: 'M 800 116 V 156', label: 'clone', lx: 808, ly: 140, anchor: 'start' })}
      ${arrow({ d: 'M 95 116 V 214 H 660 V 40 H 800 V 56', label: 'fallback: a plain create when the fork fails', lx: 380, ly: 228, kind: 'dashed' })}

      ${note({ x: 320, y: 140, text: 'never destroyed: that deletes the checkpoint', anchor: 'middle' })}
      ${note({ x: 555, y: 158, text: 'rebuilt once when the fork says not found', anchor: 'middle' })}
    `,
    caption: html`The base is provisioned by a handful of execs: the package manager installs git and gh, the
      launcher installs Claude Code without a token, the WebJs scaffolder is installed globally, and a git
      identity is set so commits need no per-run setup. A fork copies the base’s size and nothing else,
      not even labels, so a task machine is found by the id and name stored on its row.`,
  });
}

/** Figure: how the credentials reach Claude Code, and where they never go. */
export function credentialFigure() {
  return figure({
    label:
      'The tokens leave the Genie process only in the body of one buffered exec. The guest agent runs the launcher, the launcher execs Claude Code, and every line of output passes through a redactor before Genie stores it.',
    viewBox: '0 0 920 290',
    minW: 'min-w-[820px]',
    body: html`
      ${frame({ x: 20, y: 30, w: 260, h: 240, label: 'the Genie process', tone: 'plain' })}
      ${box({ x: 40, y: 60, w: 220, h: 60, label: 'process.env', sub: 'Claude token, GitHub token, Pilots key', tone: 'strong' })}
      ${box({ x: 40, y: 140, w: 220, h: 48, label: 'runClaude', sub: 'writes prompt.md, builds one exec' })}
      ${box({ x: 40, y: 208, w: 220, h: 44, label: 'redact', sub: 'every stdout and stderr' })}

      ${box({ x: 340, y: 140, w: 200, h: 60, label: 'one buffered exec', sub: 'cmd and env in the body', tone: 'signal' })}
      ${note({ x: 440, y: 222, text: 'never the streaming exec: its env rides in a URL', anchor: 'middle' })}

      ${frame({ x: 600, y: 30, w: 300, h: 240, label: 'the task machine' })}
      ${box({ x: 620, y: 60, w: 260, h: 44, label: 'guest agent', sub: 'bash, as the pilot user' })}
      ${box({ x: 620, y: 120, w: 260, h: 44, label: 'launcher', sub: 'installs Claude Code once, then execs it' })}
      ${box({ x: 620, y: 180, w: 260, h: 52, label: 'claude -p', sub: 'prompt from a file, stream-json to a log', tone: 'strong' })}
      ${note({ x: 750, y: 256, text: 'on disk: the prompt and the log, never a token', anchor: 'middle' })}

      ${arrow({ d: 'M 150 124 V 136', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 264 164 H 336', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 544 170 H 580 V 82 H 616', label: 'env', lx: 566, ly: 128, anchor: 'middle' })}
      ${arrow({ d: 'M 750 104 V 116', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 750 164 V 176', label: 'exec', lx: 758, ly: 174, anchor: 'start' })}
      ${arrow({ d: 'M 616 206 H 580 V 258 H 300 V 230 H 264', label: 'tail the log, read the last line', lx: 440, ly: 272 })}
    `,
    caption: html`The git credential helper travels the same way, as environment variables that rewrite the
      remote URL, so the agent can push and run gh itself. Git prints the rewritten remote on an error and
      gh can echo a token in a refusal, which is why the redactor knows every secret value and runs on
      every byte before it is recorded or thrown.`,
  });
}

/** Figure: the runs inside the Plan and In progress stages, in order. */
export function stagesFigure() {
  return figure({
    label:
      'The plan run writes a plan outside the repository and posts it on the issue. The build run works on a branch and opens the pull request, a backstop opens it when the run did not, the self-review fixes and comments on it, and the preview poll waits for the head commit’s preview.',
    viewBox: '0 0 920 235',
    minW: 'min-w-[820px]',
    body: html`
      ${box({ x: 20, y: 60, w: 130, h: 56, label: 'plan', sub: 'timeboxed, one run' })}
      ${box({ x: 190, y: 60, w: 150, h: 56, label: 'build', sub: 'branch, commits, push, PR' })}
      ${box({ x: 380, y: 60, w: 140, h: 56, label: 'backstop', sub: 'push and open if none' })}
      ${box({ x: 560, y: 60, w: 150, h: 56, label: 'self-review', sub: 'fix, commit, comment' })}
      ${box({ x: 750, y: 60, w: 150, h: 56, label: 'preview poll', sub: 'the head commit only', tone: 'signal' })}

      ${box({ x: 20, y: 170, w: 130, h: 44, label: 'PLAN.md', sub: 'outside the repository', tone: 'sunken' })}
      ${box({ x: 190, y: 170, w: 150, h: 44, label: 'issue comment', sub: 'posted before any code' })}
      ${box({ x: 750, y: 170, w: 150, h: 44, label: 'machine URL', sub: 'when there is no preview', tone: 'dead' })}

      ${arrow({ d: 'M 154 88 H 186', label: 'stack line', lx: 170, ly: 52 })}
      ${arrow({ d: 'M 344 88 H 376', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 524 88 H 556', label: 'PR resolved', lx: 540, ly: 52 })}
      ${arrow({ d: 'M 714 88 H 746', label: 'new head', lx: 730, ly: 52 })}
      ${arrow({ d: 'M 85 120 V 166', label: 'writes', lx: 93, ly: 146, anchor: 'start' })}
      ${arrow({ d: 'M 154 192 H 186', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 825 120 V 166', label: 'after the budget', lx: 817, ly: 146, anchor: 'end', kind: 'dashed' })}
      ${note({ x: 450, y: 140, text: 'a run that spent its turns still ships', anchor: 'middle' })}
    `,
    caption: html`The pull request is resolved by asking gh inside the machine for the open request on the
      branch, never by parsing the agent’s last message, and when there is none Genie pushes the branch
      and opens one. The self-review tolerates a non-zero exit: the pull request exists, so the task
      proceeds. The preview is accepted only when the comment or the commit status names the current head,
      so a push the platform has not built yet reads as not ready, never as a stale URL.`,
  });
}

/** Figure: five signals, two verdicts, and the loop back to Review. */
export function verdictFigure() {
  return figure({
    label:
      'Five signals reach two functions. Approve merges first and moves the card to Done. Request changes stores the feedback, sends the card back to In progress, revises on the same machine and branch, and returns to Review when the new head’s preview is up.',
    viewBox: '0 0 920 290',
    minW: 'min-w-[820px]',
    body: html`
      ${frame({ x: 20, y: 30, w: 250, h: 250, label: 'from the buttons or the poll' })}
      ${box({ x: 40, y: 56, w: 210, h: 34, label: 'the buttons on the card', small: true })}
      ${box({ x: 40, y: 100, w: 210, h: 34, label: 'a card to Done or In progress', small: true })}
      ${box({ x: 40, y: 144, w: 210, h: 34, label: 'a submitted PR review', small: true })}
      ${box({ x: 40, y: 188, w: 210, h: 34, label: 'a PR comment opening GENIE:', small: true })}
      ${box({ x: 40, y: 232, w: 210, h: 34, label: 'a merge by hand', small: true })}

      ${box({ x: 330, y: 130, w: 150, h: 50, label: 'verdicts', sub: 'approve, requestChanges', tone: 'strong' })}
      ${box({ x: 540, y: 50, w: 160, h: 48, label: 'squash merge', sub: 'branch deleted' })}
      ${box({ x: 740, y: 50, w: 160, h: 48, label: 'Done', sub: 'preview cleared' })}
      ${box({ x: 740, y: 130, w: 160, h: 44, label: 'Review', sub: 'a person judges again' })}
      ${box({ x: 540, y: 210, w: 160, h: 52, label: 'revise run', sub: 'same machine, branch, PR', tone: 'signal' })}
      ${box({ x: 740, y: 210, w: 160, h: 52, label: 'preview poll', sub: 'the new head only' })}

      ${arrow({ d: 'M 274 155 H 326', label: 'one home', lx: 300, ly: 147 })}
      ${arrow({ d: 'M 484 148 H 510 V 74 H 536', label: 'Approve', lx: 502, ly: 118, anchor: 'end' })}
      ${arrow({ d: 'M 484 162 H 510 V 236 H 536', label: 'Request changes', lx: 502, ly: 200, anchor: 'end' })}
      ${arrow({ d: 'M 704 74 H 736', label: 'then move', lx: 720, ly: 44 })}
      ${arrow({ d: 'M 704 236 H 736', label: 'push', lx: 720, ly: 228 })}
      ${arrow({ d: 'M 820 206 V 178', label: 'ready again', lx: 830, ly: 196, anchor: 'start' })}
      ${note({ x: 820, y: 116, text: 'the platform deploys main', anchor: 'middle' })}
    `,
    caption: html`A refused merge moves nothing: the card stays in Review with the reason on it, and there is no
      failed badge because a person, not a stage, is the one to act. The revise path clears the feedback on
      success only, so a revise that fails retries with the same instruction. A merge done by hand on
      GitHub takes the Approve path with no second merge.`,
  });
}

/** Figure: a redeploy on Pilots, seen from the two machines involved. */
export function redeployFigure() {
  return figure({
    label:
      'A redeploy stops Genie’s machine from the host, so no signal reaches the guest. The agent on the task machine keeps running. The new replica releases every claim at boot and its first tick re-claims the task on the same machine, branch and pull request.',
    viewBox: '0 0 920 215',
    minW: 'min-w-[820px]',
    body: html`
      ${arrow({ d: 'M 130 30 H 900', label: 'time', lx: 900, ly: 24, anchor: 'end', kind: 'dashed' })}
      ${note({ x: 20, y: 76, text: 'Genie replica', strong: true })}
      ${note({ x: 20, y: 176, text: 'task machine', strong: true })}

      ${box({ x: 130, y: 50, w: 200, h: 44, label: 'build stage running', sub: 'claim held' })}
      ${box({ x: 360, y: 50, w: 120, h: 44, label: 'power cut', sub: 'the VMM is stopped', tone: 'dead' })}
      ${box({ x: 510, y: 50, w: 170, h: 44, label: 'new replica boots', sub: 'every claim released' })}
      ${box({ x: 710, y: 50, w: 190, h: 44, label: 'first tick re-claims', sub: 'same machine, branch, PR', tone: 'signal' })}

      ${box({ x: 130, y: 150, w: 350, h: 44, label: 'claude -p keeps running', sub: 'its log keeps growing', tone: 'strong' })}
      ${box({ x: 510, y: 150, w: 170, h: 44, label: 'probe answers', sub: 'the clone is still there' })}
      ${box({ x: 710, y: 150, w: 190, h: 44, label: 'log tailed again', sub: 'the PR found with gh' })}

      ${arrow({ d: 'M 334 72 H 356', label: '', lx: 0, ly: 0, kind: 'dashed' })}
      ${arrow({ d: 'M 484 72 H 506', label: '', lx: 0, ly: 0, kind: 'dashed' })}
      ${arrow({ d: 'M 684 72 H 706', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 760 98 V 130 H 595 V 146', label: 'does the machine still answer', lx: 680, ly: 124 })}
      ${arrow({ d: 'M 484 172 H 506', label: '', lx: 0, ly: 0 })}
      ${arrow({ d: 'M 684 172 H 706', label: '', lx: 0, ly: 0 })}
    `,
    caption: html`One replica means no other live claimant, so every claim found at boot belongs to a process
      that no longer exists and is released before the first tick. Where a platform does deliver a signal,
      the worker stops claiming, drains for a few seconds, and writes the same feed line for anything
      still running, so the boot-time release finds nothing to do.`,
  });
}
