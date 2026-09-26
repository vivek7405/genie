import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { arrowDefs } from '#lib/design/diagram.ts';
import { fieldLabelClass } from '#lib/utils/ui.ts';
import { section, siteProseClass } from '#lib/utils/site.ts';
import { cn } from '#lib/utils/cn.ts';
import {
  credentialFigure,
  forkFigure,
  redeployFigure,
  stagesFigure,
  stateFigure,
  syncFigure,
  tickFigure,
  verdictFigure,
} from '#modules/architecture/utils/figures.ts';

// /architecture/internals: the mechanisms, drawn one at a time, for a reader
// who has decided to look closely. /architecture answers why the system is
// shaped like this; this page answers how each piece actually works.
//
// Everything here comes from the milestone plans (issues 1 to 7) and the code
// on the branch. Nothing is invented to fill a figure. Each section also
// states its idea in ordinary words, so the page reads without the
// background it otherwise assumes.

export const metadata = {
  title: 'Internals',
  description:
    'Genie end to end, drawn: the task state machine, the claim and the stale claim, the GitHub sync and its budget, the base machine and the fork, how credentials reach Claude Code, the stages, the verdicts, and what a redeploy does to a running build.',
};

const PROSE = siteProseClass();
const H3 = 'm-0 text-heading font-semibold tracking-tight';
const MARK = '<!-- genie-plan -->';

const CONTENTS: [string, string][] = [
  ['plain', 'Start here'],
  ['states', 'The state machine'],
  ['claim', 'The claim'],
  ['sync', 'The sync'],
  ['machine', 'The machine'],
  ['credentials', 'Credentials'],
  ['stages', 'The stages'],
  ['verdicts', 'Verdicts'],
  ['redeploy', 'A redeploy'],
  ['glossary', 'Glossary'],
  ['budgets', 'Budgets'],
];

const GLOSSARY: [string, string][] = [
  ['a stage', 'The work Genie does while a card sits in one column. Todo’s stage claims and prepares a machine, Plan’s writes the plan, In progress’s builds, self-reviews and waits for the preview. A stage ends by advancing, failing or deferring, and nothing else.'],
  ['a claim', 'A timestamp on the task row saying a worker is driving it, plus a count of attempts. Finishing a stage clears it. A claim older than the stage’s budget belongs to a process that died, and the row is claimable again.'],
  ['a verdict', 'The one decision a person makes: Approve, or Request changes with feedback. It is given by a button, a card move, a pull request review, a comment addressed to Genie, or a merge by hand, and all five reach the same two functions.'],
  ['the genie label', 'The opt-in. Only an issue carrying it is imported, mirrored or automated, so a board can hold any number of human-only cards. Genie creates the label on a repository if it is missing and puts it on every issue it opens.'],
  ['a marker', 'An HTML comment on the first line of every comment Genie posts, and at the end of every issue it opens. Genie posts with the same token the reviewer uses, so the marker is the only thing that tells its writes from a person’s.'],
  ['the base machine', 'A Pilots machine named genie-base, provisioned once with git, gh, Claude Code and the WebJs scaffolder, then checkpointed. It is never destroyed, because destroying a machine deletes its checkpoints, and suspended it costs nothing.'],
  ['a fork', 'A new machine restored from a checkpoint of another. A task machine is a fork of the base, so it is answering before the plan is written. A fork copies the base’s size and nothing else, not even labels.'],
  ['the launcher', 'A shell script with no credential in it that installs Claude Code the first time, marks onboarding done, and then execs Claude Code in place, so the tokens are the environment of exactly one process.'],
  ['stream-json', 'Claude Code’s line-per-message output. Genie sends it to a log file on the task machine, tails the new bytes for the activity feed, and reads the last line for the result and any rate-limit event.'],
  ['a deferral', 'What a rate limit becomes. The task keeps its stage and gains a time to try again; the card says it is waiting. It is not a failure and it does not count as an attempt.'],
  ['the preview', 'A machine the Pilots GitHub App starts for each pull request, announced by a comment on the pull request and a commit status on the head commit. Genie only reads those and never builds one.'],
];

const BUDGETS: [string, string, string][] = [
  ['Worker tick', 'every 2 s', 'One pass claims up to the concurrency in rows, oldest first.'],
  ['Concurrency', '1 task, and 1 per project', 'The default suits one subscription token. The per-project cap holds even when the global one is raised.'],
  ['GitHub poll', 'every 30 s', 'Two requests per project per pass, plus one per task in Review. A rate-limit reply pauses the loop until the reset it names.'],
  ['Board query', 'the first 100 items, 1 point', 'A larger board reads the first page and records a warning once.'],
  ['Stale claim', '5, 15 and 90 min', 'Per stage: Todo, Plan, In progress. A claim older than its stage’s window is a crashed run.'],
  ['Attempt ceiling', '3', 'A stale claim past the ceiling fails the stage with a reason instead of re-claiming, so a crash loop ends in a card a person can read. Retry resets the count.'],
  ['Plan run', '3 min, 12 turns', 'No verification pass and no subagents. A run that exits badly but left the plan file is accepted.'],
  ['Build run', '45 min, 200 turns', 'Branch, implementation, checks, commits, push and the pull request.'],
  ['Self-review run', '10 min, 60 turns', 'Claude Code’s own code-review skill, told to fix and to comment.'],
  ['Preview poll', 'every 15 s, up to 10 min', 'Then the app is started inside the task machine and the machine’s URL is used instead.'],
  ['Log tail', 'every 5 s', 'Only the new bytes; one feed line per assistant message and tool call, capped at a short line.'],
  ['Rate-limit backoff', '5, 15, 30, then 60 min', 'Or one minute after the reset Claude names, when it names one within six hours.'],
  ['Task machine', '2048 MiB', 'Set on the base by a resize; forks inherit it. The base idles out after an hour of quiet.'],
  ['Machine quota', '20 per organisation', 'The base plus nineteen task machines. Past it, the stage fails with a message that says to run the cleanup.'],
  ['Cleanup', 'after 3 days', 'A sweep destroys the machine of every done task and of tasks that failed longer ago than that, and never the base.'],
  ['Drain on a signal', '8 s', 'Under the framework’s own hard exit. On Pilots nothing sees the signal and the boot-time release does the work.'],
];

/** The plain-language aside under a dense section. Additive: it explains, it does not simplify away. */
function plainly(body: unknown) {
  return html`
    <aside class="mt-6 border-l-2 border-border-strong pl-5">
      <p class="m-0 max-w-[68ch] text-meta leading-[1.7] text-muted-foreground">
        <span class=${cn(fieldLabelClass(), 'mr-2')}>In plain terms</span>${body}
      </p>
    </aside>
  `;
}

export default function Internals() {
  return html`
    ${arrowDefs()}

    <div class="border-b border-border">
      <div class="mx-auto max-w-6xl px-4 pb-12 pt-14 sm:px-6 md:pb-16 md:pt-20">
        <h1 class="m-0 max-w-[22ch] text-[2.2rem] font-bold leading-[1.05] tracking-tight sm:text-[2.9rem]">The whole thing, drawn</h1>
        <p class=${cn(PROSE, 'mt-6 text-heading')}>
          Eight figures and the mechanisms behind them: how a table becomes a queue, what a poll does with a board a person also edits, how a machine is forked rather than booted, where the tokens are and are not, and what a redeploy does to a build in flight. Every section also says its idea in ordinary words.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a class=${cn(buttonClass({ variant: 'outline' }), 'no-underline')} href="/architecture">The shape, on one page</a>
        </div>
      </div>
    </div>

    <nav aria-label="On this page" class="border-b border-border">
      <div class="mx-auto flex max-w-6xl flex-wrap items-baseline gap-x-5 gap-y-2 px-4 py-4 sm:px-6">
        <span class=${fieldLabelClass()}>On this page</span>
        ${CONTENTS.map(([id, label]) => html`<a class="text-meta text-muted-foreground no-underline transition-colors hover:text-foreground" href=${'#' + id}>${label}</a>`)}
      </div>
    </nav>

    ${section({
      id: 'plain',
      layout: 'split',
      heading: 'The whole idea, before any of the detail',
      lede: 'The rest of this page is written for somebody who already knows what a state machine and a microVM are. This section is not. Read it and you can follow every figure below.',
      body: html`
        <div class="grid gap-10 lg:grid-cols-[1.05fr_0.95fr]">
          <div>
            <p class=${cn(PROSE, 'm-0')}>
              Genie is a to-do list that does the to-dos. You write a card, the way you would hand a task to a colleague. A program inside Genie notices the card, rents a small private computer for it, reads your repository there, writes a short plan, builds the change on a branch, checks its own work, and opens a pull request with a link where you can click around the result. Then it waits for you to say yes or to say what should change.
            </p>
            <p class=${cn(PROSE, 'mt-4')}>
              The list itself is a small database file that Genie keeps. GitHub gets a copy: the card is also an issue, the board is also a GitHub project, and if you move the card or review the pull request there, Genie notices on its next look and treats it exactly as if you had pressed the button in its own dashboard.
            </p>
            <p class=${cn(PROSE, 'mt-4')}>
              The unusual decisions are the things Genie refuses to do. It never runs the agent on your computer or its own. It never puts a password on the rented computer’s disk. It never deploys anything: the platform the rented computer comes from already builds a preview for every pull request and ships the main branch when you merge, and Genie only reads the link.
            </p>
          </div>
          <div>
            <div class=${cn(cardClass(), 'p-6')}>
              <p class="m-0 font-semibold">Why anyone would build it this way</p>
              <p class="m-0 mt-2 text-meta text-muted-foreground">One process and one file are the smallest thing that can hold a queue, a board and an audit log at once. Everything that could be a second system, a queue server, a scheduler, a deploy pipeline, is either a table, a timer or somebody else’s platform.</p>
              <hr class="my-5 border-0 border-t border-border" />
              <p class="m-0 font-semibold">What it costs</p>
              <p class="m-0 mt-2 text-meta text-muted-foreground">Nothing on the GitHub side is instant, because it is read on a timer. One process means one machine and one subscription’s worth of throughput. And a run that has started cannot yet be stopped from the board.</p>
              <hr class="my-5 border-0 border-t border-border" />
              <p class="m-0 font-semibold">Where the truth lives</p>
              <p class="m-0 mt-2 text-meta text-muted-foreground">In Genie’s own database, on a volume that survives a redeploy. GitHub is a mirror that people also write to, and every disagreement is settled in the database’s favour except the two verdicts a person is allowed to give.</p>
            </div>
          </div>
        </div>`,
    })}

    ${section({
      id: 'states',
      heading: 'The state machine, and who may move a card',
      lede: 'A task has five statuses, drawn as the five columns of the board. Three transitions belong to the worker and two to a person, and one function is the only place a status ever changes.',
      body: html`
        ${stateFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>One function changes a status</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              The transition function takes the task, the status to move to, and who is asking: the system or a human. It refuses any pair the state machine does not list, writes the new status, clears the claim when the system finished a stage, records the feed line, pushes the board to every open dashboard over a socket, and mirrors the move to GitHub. The dashboard buttons, the worker and the sync all call it and nothing else writes the column.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>Failure keeps its column</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              A stage that throws does not move the card. The row keeps its status, gains an error and drops its claim, so the card stays where it was with the error on it and a Retry button. Retry clears the error, the claim, the attempt count and any deferral, and the worker re-claims the row where it stands. There is no failed column, because a card that has failed is still the same task at the same point.
            </p>
          </div>
        </div>
        ${plainly('Think of the board as five boxes on a table and the card as a token. Genie is allowed to slide the token to the right, one box at a time, and only while it is doing the work in that box. You are the only one allowed to touch it once it reaches Review, and you may push it forward to Done or back one box. If Genie trips, the token stays exactly where it was with a note on it, and you can tell Genie to try again.')}`,
    })}

    ${section({
      id: 'claim',
      layout: 'split',
      heading: 'A claim is a timestamp, and a stale one is a crash',
      lede: 'The worker has no queue to pop from. On every tick it asks the tasks table for rows in a Genie-owned stage with no error and no live claim, takes the oldest, and claims it by writing the clock into it.',
      body: html`
        ${tickFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>Stale windows are per stage</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              The stages differ by an order of magnitude, so one number would be either too slow for planning or unsafe for a build. A claim on a Todo row goes stale in minutes, because claiming and preparing a machine is quick. A claim on a Plan row is allowed a clone, an install and a timeboxed run. A claim on an In progress row is allowed the whole build, the preview wait and a revise round. When a stale claim is re-claimed the feed says so, with the attempt it came from and how long it sat. Past the attempt ceiling the stage is failed with a reason instead, so a crash loop ends in a card a person can read.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>Two caps on concurrency</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              A global cap says how many rows the worker drives at once, and it defaults to one because a subscription token is the usual credential. Independently, at most one task per project is in flight at any moment, held both in memory and in the query itself, which excludes any project that has another row with a fresh claim. So after a crash a sibling task waits out the stale window rather than racing a run that may still be executing on a machine.
            </p>
          </div>
        </div>
        ${plainly('There is no queue and no manager handing out work. Every couple of seconds the worker looks at the list, finds the oldest card that is Genie’s to do and that nobody is holding, and writes its name and the time on it. If a worker dies mid-task, the name stays on the card until enough time has passed that it must be dead, and then the card is up for grabs again. After a few such deaths the card is marked failed with an explanation rather than being picked up forever.')}`,
    })}

    ${section({
      id: 'sync',
      heading: 'Two requests per project per pass',
      lede: 'GitHub is read on a timer, never through webhooks, because a personal project board has none. Each pass reads the board and the labelled issues, reconciles them against the database, and writes back only through the transitions the state machine allows.',
      body: html`
        ${syncFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>What a pass does with what it read</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              An open labelled issue whose card sits in Todo, or whose project has no board, becomes a task. A labelled issue found in a Genie-owned column with no task behind it is somebody else’s work in flight and is left alone. A task Genie owns whose card was dragged elsewhere is moved back. A task in Review whose card is in Done is approved, and one whose card is back in In progress is sent back with the newest comment that carries no marker as the feedback, or a fixed sentence when there is none. A task the dashboard created that never got its issue is retried here, and the retry finds the issue by the marker in its body before it would ever create a second one.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>Markers, not authors</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              Genie posts with the operator’s own token, so the author of a comment is the reviewer’s own login and an author rule would discard every human comment. Every comment Genie writes therefore opens with a comment of the form <span class="font-mono text-meta">${MARK}</span>, and the sync skips any comment carrying one. The mirror itself runs inside the transition, awaited and never throwing: a card is moved on every status, a status comment is posted on reaching Review and Done, and a failure is an event on the card that the next pass repairs.
            </p>
          </div>
        </div>
        ${plainly('Every half minute Genie glances at GitHub and asks two questions per project: which cards are in which columns, and which issues carry its label. From the answers it adopts new cards, puts back any of its own cards that were moved, and reads a verdict off any card that was waiting for one. When it writes to GitHub it signs each comment with an invisible mark, because it uses your account and the mark is the only way to tell its comments from yours.')}`,
    })}

    ${section({
      id: 'machine',
      layout: 'split',
      heading: 'Forked from a checkpoint, never booted',
      lede: 'A task machine is a Pilots microVM restored from a checkpoint of a base machine that already has everything installed, which is why it is ready in the time a fork takes rather than the time an install takes.',
      body: html`
        ${forkFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>Why the base is never destroyed</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              Destroying a machine on Pilots deletes its checkpoints and their snapshot objects, and a checkpoint is only found on a live machine. So the base stays alive, suspended when quiet, and its checkpoint id is kept in Genie’s settings table. The build of the base is serialised behind one in-flight promise so two concurrent tasks never build two bases, and a fork that fails because the checkpoint is gone clears the setting, rebuilds once and forks again.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>Found by name, sized by the base</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              A fork copies the base’s processor count, memory and image and carries no labels, so the id and the name on the task row are the only join from a machine back to its task, and the cleanup sweep uses exactly those. The name is the repository’s slug plus the first characters of the task id, kept within the platform’s rules for a DNS label. Memory is set once on the base by a resize and inherited. A retry that finds a machine of that name reuses it rather than forking again.
            </p>
          </div>
        </div>
        ${plainly('Instead of setting up a fresh computer for every task, Genie set one up once, with all the tools installed, and took a photograph of it. A new task gets a copy of that photograph brought back to life, which takes seconds. The original is kept, asleep, because on this platform throwing away the original also throws away the photograph.')}`,
    })}

    ${section({
      id: 'credentials',
      heading: 'One process holds the tokens, and no file does',
      lede: 'Claude Code needs a Claude token to run and a GitHub token to push and open the pull request. Both reach the task machine as the environment of one buffered exec and are never granted to the machine, never passed in a URL and never written to its disk.',
      body: html`
        ${credentialFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>Why not the platform’s secret broker</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              Pilots can grant a secret to a machine, but a granted secret is fetched from a broker URL, which neither Claude Code nor git can consume, and it would then be reachable by anything in the guest for the machine’s whole life. A buffered exec puts the environment in the request body and hands it to one shell. The streaming exec is never used for anything with a secret, because it carries its environment in the URL of a socket.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>The prompt is a file, the output is a log</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              The prompt is written to a file on the machine with a quoted heredoc, so arbitrary prompt text needs no shell quoting and stays out of the process list, and Claude Code is asked to read it from there. Its stream goes to a log file that a poller tails for the activity feed while the run is in flight, and after the run the last line of the log is the result object and the last rate-limit event is read beside it. Output of every exec passes through a redactor that knows the token values before it is stored or thrown.
            </p>
          </div>
        </div>
        ${plainly('The passwords Genie holds are handed to exactly one program on the rented computer, at the moment it starts, the way you might whisper a code to one person rather than pin it on the wall. Nothing is saved to the computer’s disk, so a copy of that computer carries nothing, and everything the program prints is checked for the passwords before Genie writes it down.')}`,
    })}

    ${section({
      id: 'stages',
      layout: 'split',
      heading: 'Plan, build, self-review, preview',
      lede: 'Two stages do the work. Plan is one short timeboxed run that ends in a plan on the issue. In progress is one long run that ends in a pull request, followed by a self-review of that pull request and a wait for its preview.',
      body: html`
        ${stagesFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>The stack is decided in the plan</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              The plan’s first section holds exactly one line naming one of three branches. An existing app is built in its own stack, whatever it is, and WebJs is never introduced. An empty repository is probed rather than trusted to the plan: no manifest and fewer than a handful of tracked files. Genie scaffolds WebJs at the root itself, clears the gallery and commits the scaffold as its own first commit before the build run starts, because the Pilots GitHub App builds the repository root and a nested app would never get a preview. A new app inside a monorepo is scaffolded by the build run in the directory the plan names, respecting the workspace layout already there.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>Safe to run twice</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              A stage can be re-claimed after a stale claim or a redeploy, so every stage is idempotent on its row. The machine is reused while a probe answers, and the clone is skipped when it does. The branch is reused when set, and the build prompt checks out an existing branch and keeps its commits. The pull request is reused when its number is set, and otherwise gh is asked for the open request on the branch before Claude is run at all, so a second attempt never opens a second one. The plan run simply overwrites the plan, and the comment is posted again only when no plan was stored.
            </p>
          </div>
        </div>
        ${plainly('First a short session reads your request and your code and writes down what it intends to do, and that note is posted on the issue for you to see. Then a long session does it on a branch, running the project’s own checks, and opens the pull request. If it ran out of time before the last step, Genie finishes the last step itself. Then a second session reads the pull request the way a reviewer would, fixes what it finds, and leaves its notes. Only then does the card ask for you.')}`,
    })}

    ${section({
      id: 'verdicts',
      heading: 'Five signals, two verdicts',
      lede: 'A card in Review waits for one of two decisions, and a person can give either from the dashboard or from GitHub. Every route reaches the same two functions, so the merge and the feedback handling exist once.',
      body: html`
        ${verdictFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>Approve is a merge, then a move</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              Approve takes an exclusive claim on the row, squash-merges the pull request over the API, deletes the branch, and only then moves the card to Done, clears the preview URL because the platform destroys the preview when the request closes, and reads the production URL from the Pilots services list. A task with no pull request, an early stub or a repository without GitHub wired, approves without a merge so the board keeps working in development. The machine is not destroyed on approve: a merged task stays inspectable until the cleanup sweep, and there is exactly one destroy path in the codebase.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>What counts as a request for changes</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              A card moved back to In progress, with the newest unmarked comment as the feedback. A submitted pull request review in the changes-requested state, whose body and unresolved threads are the feedback; a review that only comments, and a lone inline thread, are a reviewer still reading and do not wake the agent, and an approved review is Approve. A pull request comment whose body opens with GENIE:, the rest being the feedback. And the dashboard’s own form, whose note is posted to the issue so the GitHub side sees why the card moved. After the revise push, the run replies on each thread it addressed and asks the reviewer to look again.
            </p>
          </div>
        </div>
        ${plainly('Saying yes merges the change and moves the card to Done, and the platform ships it. Saying what should change sends the same task back to the same rented computer and the same branch, with your note, and the card returns to Review once the new version has its own preview link. You can say either from Genie’s own page, by dragging the card on GitHub, by reviewing the pull request, or by leaving a comment that starts with GENIE:.')}`,
    })}

    ${section({
      id: 'redeploy',
      layout: 'split',
      heading: 'A redeploy is a power cut',
      lede: 'On Pilots a volume-backed service is one replica, and a redeploy stops its microVM from the host with no signal delivered inside. So the recovery that matters happens at the next boot, and the build that was running is not lost, because it was never running in Genie’s process.',
      body: html`
        ${redeployFigure()}
        <div class="mt-12 grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>The boot-time release</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              Before its first tick the new worker clears every claim on a Genie-owned row, writes one feed line per task saying it was interrupted by a restart and will be resumed, and pushes the board. One replica means there is no other live claimant, so every claim found at boot belongs to a process that no longer exists. The first tick then re-claims those tasks immediately under the idempotency rules above, and the stale windows are only ever waited out when the process keeps running but a stage silently hangs. A dev reload does not re-run the release: it is guarded by the same process-global flag as the signal handlers.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>Where a signal does arrive</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              Under docker compose, in development and in CI the process does receive a termination signal. The worker then stops claiming, waits a few seconds for in-flight stages to settle, and for anything still running writes the same feed line and releases the claim, so the next boot finds nothing to do. The database survives either path because SQLite in write-ahead mode is crash-safe, and the busy timeout on the connection is what lets the new process’s first write succeed.
            </p>
          </div>
        </div>
        ${plainly('When Genie itself is updated, its computer is simply switched off and a new one switched on. The agent was working on a different computer all along, so it keeps going. The new Genie wakes up, notices which cards were being held by the old one, writes a note on each saying so, and picks them straight back up, finding the same machine, the same branch and the same pull request where they were left.')}`,
    })}

    ${section({
      id: 'glossary',
      heading: 'The words this page leans on',
      lede: 'A technical page usually loses a reader on vocabulary rather than on ideas. These are the terms doing the work above, defined without pretending the simple version is the whole story.',
      body: html`
        <dl class="m-0 grid gap-x-12 gap-y-0 lg:grid-cols-2">
          ${GLOSSARY.map(
            ([term, def], i) => html`
              <div class=${cn('py-5', i > 0 && 'border-t border-border', i === 1 && 'lg:border-t-0')}>
                <dt class="m-0 font-mono text-meta font-semibold">${term}</dt>
                <dd class="m-0 mt-2 max-w-[56ch] text-meta leading-[1.7] text-muted-foreground">${def}</dd>
              </div>
            `,
          )}
        </dl>`,
    })}

    ${section({
      id: 'budgets',
      layout: 'split',
      heading: 'The budgets, as written',
      lede: 'None of these is measured. They are the constants the plans fix, printed so a reader can check a claim above against the number behind it, and so a change to one of them is a change to this page.',
      body: html`
        <div class="overflow-x-auto">
          <table class="w-full min-w-[640px] border-collapse text-body">
            <caption class="sr-only">Each budget, its value, and what it governs</caption>
            <thead>
              <tr class="border-b border-border-strong text-left">
                <th scope="col" class=${cn(fieldLabelClass(), 'py-3 pr-6 font-medium')}>Budget</th>
                <th scope="col" class=${cn(fieldLabelClass(), 'py-3 pr-6 font-medium')}>Value</th>
                <th scope="col" class=${cn(fieldLabelClass(), 'py-3 font-medium')}>What it governs</th>
              </tr>
            </thead>
            <tbody>
              ${BUDGETS.map(
                ([name, value, governs]) => html`
                  <tr class="border-b border-border align-top">
                    <td class="whitespace-nowrap py-3.5 pr-6 font-semibold">${name}</td>
                    <td class="whitespace-nowrap py-3.5 pr-6 font-mono text-meta">${value}</td>
                    <td class="py-3.5 text-meta text-muted-foreground">${governs}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>
        <p class=${cn(PROSE, 'mt-10')}>
          Everything drawn on this page is written down in full in the repository’s milestone issues, and the code implementing it sits beside them. If a figure here disagrees with the repository, the repository is right and this page is a bug. <a href="/architecture">The architecture page</a> is the same system as a shape rather than as mechanisms.
        </p>`,
    })}
  `;
}
