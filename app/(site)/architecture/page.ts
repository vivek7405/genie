import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { arrow, arrowDefs, box, figure, frame } from '#lib/design/diagram.ts';
import { fieldLabelClass } from '#lib/utils/ui.ts';
import { section, siteProseClass } from '#lib/utils/site.ts';
import { cn } from '#lib/utils/cn.ts';

// /architecture: the shape, for a reader deciding whether to trust it. The
// mechanisms, drawn one at a time, are on /architecture/internals.
//
// Everything here comes from the milestone plans (issues 1 to 7) and the code
// on the branch. Nothing is invented for the page. Every section stands
// alone: a reader arriving mid-page from a link must be able to read a
// heading and its first sentence with nothing above it.

export const metadata = {
  title: 'Architecture',
  description:
    'How Genie is built: one WebJs process, a SQLite state machine as the queue, GitHub as a polled mirror, one Pilots microVM per task with Claude Code inside it, and previews and deploys left to the platform.',
};

const PROSE = siteProseClass();
const H3 = 'm-0 text-heading font-semibold tracking-tight';
const MONO_BLOCK = 'm-0 overflow-x-auto rounded-md bg-paper-sunken px-4 py-3 font-mono text-meta leading-relaxed text-foreground';

/**
 * The system as five layers, in plain words. Each layer works without the
 * ones above it, which is the order they are in.
 */
const LAYERS: [string, string][] = [
  [
    'One app',
    'Genie is a single WebJs process. It serves the public site, the dashboard where cards move across a board, and a worker loop that starts when the process boots and drives every card that is Genie’s to drive. There is no second service, no queue server and no scheduler: the app is the whole deployment.',
  ],
  [
    'The table is the queue',
    'A task is a row in SQLite with a status. A row sitting in a stage Genie owns, with no error recorded, is work to do; claiming it is writing a timestamp on it. Every change of status and every line the agent prints lands in an events table beside it, so the card’s activity feed is the audit log and there is no other one.',
  ],
  [
    'GitHub is a mirror',
    'The task is an issue, the board is a GitHub Project, and a label named genie is the switch that says a card is Genie’s to work. Genie writes to GitHub after every move and reads it back on a timer. Its own database stays the truth, so it works with no board at all, and a human’s verdict on GitHub counts exactly as much as a button in the dashboard.',
  ],
  [
    'A machine per task',
    'Every task gets its own Pilots microVM, forked from a checkpoint of a base machine that already has git, gh and Claude Code on it. Claude Code runs there headless, with the repository cloned beside it. The credentials it needs arrive as the environment of one process and are never written to the machine’s disk.',
  ],
  [
    'The platform deploys, Genie does not',
    'A repository connected to Pilots gets a preview machine on every pull request and a production deploy on every merge, from the Pilots GitHub App. Genie reads the preview URL off the pull request and puts it on the card. It never builds an image, never runs a deploy and never holds a production credential.',
  ],
];

/** The rules that cost the most if they were ever relaxed. */
const RULES: [string, string][] = [
  [
    'Genie’s database is the source of truth, and GitHub is a mirror of it',
    'The sync never writes a task’s status from the board except through the two human verdicts, and those go through the same transition function the dashboard buttons use, so the state machine decides either way. A mirror write that fails is an event on the card and is re-asserted on the next poll, which is why the board converges instead of drifting.',
  ],
  [
    'Ownership is by column',
    'A person owns Todo and the verdict out of Review. Genie owns Plan, In progress, and the Review state itself. On every poll the sync moves a card back to where Genie says it is when a human dragged it somewhere Genie owns, and a genie-labelled issue found in a Genie-owned column with no task behind it is somebody else’s work in flight and is left alone.',
  ],
  [
    'The agent never runs on your machine or on Genie’s',
    'Each task forks its own microVM and does everything there: the clone, the plan, the build, the checks, the push. When the process that exec’d into it is gone the machine keeps running, so a redeploy of Genie in the middle of a build does not lose the build.',
  ],
  [
    'A credential is the environment of one process, never a file',
    'The Claude token, the GitHub token and the git credential helper travel only in the body of one buffered exec, into the shell that installs and then execs Claude Code. The prompt is a file, the tokens are not. Nothing is passed over the streaming exec, whose environment rides in a URL, and every byte of output is passed through a redactor before it is stored or thrown.',
  ],
  [
    'A stage must be safe to run twice',
    'A claim can expire, a process can be cut, and the next worker re-claims the row where it stands. So a stage reuses the machine when it still answers, the branch when it exists, and the pull request when one is open for the branch, and a second attempt never opens a second pull request or a second machine.',
  ],
];

const STAGES: [string, string][] = [
  ['Claim', 'The worker takes the row, records the attempt, and makes sure the task has a machine: reuse the one on the row when it still answers a probe, otherwise fork a new one from the base checkpoint and clone the repository into it.'],
  ['Plan', 'One timeboxed run, a few minutes and a dozen turns, no verification pass. It writes a compact plan outside the repository, so it can never be committed, and the plan is posted on the issue before any code. Its first line names the stack.'],
  ['Build', 'One long run on a branch in the machine. The agent follows the repository’s conventions, runs its checks, commits per logical unit, pushes and opens the pull request. If the run spends its turns before that last step, Genie pushes the branch and opens the pull request itself.'],
  ['Self-review', 'Before anyone is asked to look, a second run reviews the pull request with Claude Code’s own code-review skill, fixes what it finds on the same branch, and leaves its comments on the pull request. A failed self-review is logged and the task proceeds: the pull request exists either way.'],
  ['Preview', 'Genie polls the pull request for the preview the Pilots GitHub App posts against the branch’s head commit. When the repository is not connected to Pilots, it starts the app inside the task machine and uses the machine’s own URL instead, and says so on the card.'],
];

const OWNERSHIP: [string, string, string][] = [
  ['Todo', 'you', 'Nothing. A card here is yours to write, move or delete, and Genie reads it when it is time to claim it.'],
  ['Plan, In progress', 'Genie', 'Re-assert. A card a person dragged elsewhere is moved back to where Genie’s database says it is.'],
  ['Review', 'Genie, awaiting you', 'Read the verdict. Done applies Approve, In progress applies Request changes with your newest comment as the feedback, anything earlier is a failed mirror and is moved back.'],
  ['Done', 'you', 'Nothing. A merged task stays where it is.'],
];

const VERDICTS: [string, string][] = [
  ['The buttons on the card', 'Approve, or Request changes with a note. The note is posted to the issue so the GitHub side sees why the card moved back.'],
  ['A card move on the board', 'To Done is Approve. Back to In progress is Request changes, with the newest comment that is not Genie’s own as the feedback.'],
  ['A submitted pull request review', 'Changes requested is Request changes, with the review body and its unresolved threads. Approved is Approve. A review that only comments, or a lone inline thread, is a reviewer still reading and does not wake the agent.'],
  ['A pull request comment addressed to Genie', 'A comment whose body opens with GENIE: is Request changes, and the rest of the comment is the feedback.'],
  ['A merge by hand', 'A pull request merged on GitHub is noticed by the same poll and the card moves to Done with no second merge.'],
];

const COSTS: [string, string][] = [
  [
    'Polling latency',
    'GitHub has no webhooks for a personal project board, so the mirror is a poll. A verdict given on GitHub takes up to one poll interval to reach the card, the preview URL takes up to one preview poll to appear, and the worker itself wakes on a tick. Nothing on the GitHub side is instant, and nothing is pretended to be.',
  ],
  [
    'One replica',
    'The database is one SQLite file on one volume, which means exactly one process writes it and Genie runs as one machine. That is the right size for one operator and one subscription. It does not scale sideways, and a second replica would be a second writer.',
  ],
  [
    'A subscription’s rate limits',
    'Claude Code runs on a subscription token, so the worker drives one task at a time by default and a rate limit is a deferral rather than a failure: the card says it is waiting and the worker returns at the reset time, or on a backoff that stretches to an hour. Throughput is whatever the subscription allows.',
  ],
  [
    'A single writer, and a best-effort mirror',
    'Every GitHub write is one process talking to a remote API that can refuse. So a mirror write is awaited, never retried inline, and never allowed to fail a transition: it becomes an event on the card, and the next poll re-asserts the board. The board can therefore lag the truth for one poll, and it can never be the truth.',
  ],
  [
    'No cancel mid-run, yet',
    'A stage that has been claimed runs until it completes, fails or times out. There is no button that stops the agent partway through a build. Retry exists only after a failure, and the way to end a run that should not be running is to wait out its budget.',
  ],
];

/** The five layers, drawn: what talks to what, and in which direction. */
function overviewFigure() {
  return figure({
    label:
      'Genie is one process with a SQLite file beside it. The sync polls GitHub and mirrors back; the worker execs into a task machine on Pilots, which pushes the branch and opens the pull request; the Pilots GitHub App posts the preview.',
    viewBox: '0 0 920 365',
    minW: 'min-w-[820px]',
    body: html`
      ${frame({ x: 20, y: 50, w: 230, h: 270, label: 'GitHub' })}
      ${box({ x: 40, y: 80, w: 190, h: 48, label: 'issue', sub: 'with the genie label' })}
      ${box({ x: 40, y: 144, w: 190, h: 48, label: 'board card', sub: 'one of five columns' })}
      ${box({ x: 40, y: 208, w: 190, h: 48, label: 'pull request', sub: 'reviews, comments, the preview' })}

      ${frame({ x: 320, y: 50, w: 280, h: 270, label: 'Genie, one process', tone: 'plain' })}
      ${box({ x: 340, y: 80, w: 240, h: 44, label: 'site and dashboard', sub: 'WebJs pages, a frame, a socket' })}
      ${box({ x: 340, y: 136, w: 240, h: 44, label: 'worker', sub: 'claims a row, runs its stage' })}
      ${box({ x: 340, y: 192, w: 240, h: 44, label: 'sync', sub: 'polls the board, mirrors back' })}
      ${box({ x: 340, y: 248, w: 240, h: 52, label: 'SQLite', sub: 'tasks is the queue, task_events the log', tone: 'strong' })}

      ${frame({ x: 670, y: 50, w: 230, h: 270, label: 'Pilots' })}
      ${box({ x: 690, y: 80, w: 190, h: 56, label: 'task machine', sub: 'Claude Code, headless', tone: 'signal' })}
      ${box({ x: 690, y: 160, w: 190, h: 48, label: 'genie-base', sub: 'the checkpoint to fork from', tone: 'sunken' })}
      ${box({ x: 690, y: 240, w: 190, h: 48, label: 'the GitHub App', sub: 'previews and deploys' })}

      ${arrow({ d: 'M 336 214 H 254', label: 'polled, mirrored', lx: 295, ly: 200, kind: 'dashed', both: true })}
      ${arrow({ d: 'M 584 158 H 640 V 108 H 686', label: 'exec', lx: 600, ly: 150 })}
      ${arrow({ d: 'M 785 156 V 140', label: 'fork', lx: 795, ly: 152, anchor: 'start', kind: 'signal' })}
      ${arrow({ d: 'M 785 76 V 22 H 30 V 232 H 36', label: 'push the branch, open the pull request', lx: 460, ly: 16 })}
      ${arrow({ d: 'M 690 264 H 650 V 342 H 135 V 260', label: 'a preview per pull request, a deploy on merge', lx: 400, ly: 356 })}
    `,
    caption: html`Everything Genie owns is in the middle column, and it is one process. The left column is the
      user’s, read on a timer and written after every move. The right column is rented per task and
      thrown away, apart from the base machine, which stays alive because destroying it would delete the
      checkpoint every task machine is forked from.`,
  });
}

export default function Architecture() {
  return html`
    ${arrowDefs()}

    <div class="border-b border-border">
      <div class="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 md:pb-20 md:pt-20">
        <h1 class="m-0 max-w-[22ch] text-[2.2rem] font-bold leading-[1.05] tracking-tight sm:text-[2.9rem]">One process, one table, one machine per task</h1>
        <p class=${cn(PROSE, 'mt-6 text-heading')}>
          Genie is a small system on purpose. A WebJs app with a SQLite file beside it, a worker loop inside it, GitHub read on a timer, and a fresh microVM for every task. The interesting decisions are where it refuses to do more than that, and they are all below.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <a class=${cn(buttonClass(), 'no-underline')} href="/architecture/internals">The internals, with diagrams</a>
          <a class=${cn(buttonClass({ variant: 'outline' }), 'no-underline')} href="#costs">What it costs</a>
        </div>
      </div>
    </div>

    ${section({
      id: 'layers',
      heading: 'The whole system, as five layers',
      lede: 'Read this first if the rest of the page is more detail than you came for. Each layer works without the ones above it, and the figure under them is the same five things drawn.',
      body: html`
        <ol class="m-0 flex list-none flex-col p-0">
          ${LAYERS.map(
            ([title, body], i) => html`
              <li class=${cn('grid grid-cols-[2.5rem_1fr] gap-4 py-6', i > 0 && 'border-t border-border')}>
                <span class="pt-1 font-mono text-meta text-muted-foreground">${i + 1}</span>
                <div>
                  <h3 class=${H3}>${title}</h3>
                  <p class=${cn(PROSE, 'm-0 mt-2')}>${body}</p>
                </div>
              </li>
            `,
          )}
        </ol>
        <div class="mt-10">${overviewFigure()}</div>
        <p class=${cn(PROSE, 'mt-8')}>
          The rest of this page is what those five sentences cost to make true. <a href="/architecture/internals">The internals page</a> draws each mechanism.
        </p>`,
    })}

    ${section({
      id: 'rules',
      heading: 'Five rules the rest is bent around',
      lede: 'Each of these is a place where the easy version would have worked on the first demo and failed on the first bad day. They are written down because the expensive ones look optional right up until they are not.',
      body: html`
        <ol class="m-0 flex list-none flex-col p-0">
          ${RULES.map(
            ([title, body], i) => html`
              <li class=${cn('grid grid-cols-[2.5rem_1fr] gap-4 py-6', i > 0 && 'border-t border-border')}>
                <span class="pt-1 font-mono text-meta text-muted-foreground">${i + 1}</span>
                <div>
                  <h3 class=${H3}>${title}</h3>
                  <p class=${cn(PROSE, 'm-0 mt-2')}>${body}</p>
                </div>
              </li>
            `,
          )}
        </ol>`,
    })}

    ${section({
      id: 'process',
      layout: 'split',
      heading: 'One process, and that is the whole deployment',
      lede: 'Genie runs as one WebJs process that serves the pages, keeps a worker loop alive and polls GitHub, with one SQLite file on a volume. WebJs ships no queue and no scheduler, so the queue is a table and the scheduler is a timer.',
      body: html`
        <div class="grid gap-5 md:grid-cols-3">
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">The pages</p>
            <p class="m-0 text-meta text-muted-foreground">The site and the dashboard are server-rendered HTML in two route groups with one set of tokens. The board is a frame that a small island reloads when the worker broadcasts a change over a socket, so the page is complete with JavaScript off and live with it on.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">The worker</p>
            <p class="m-0 text-meta text-muted-foreground">Started from the framework’s one boot seam, it ticks every couple of seconds, claims up to its concurrency in rows and runs each row’s stage. Its state rides the process global so a dev reload keeps one loop rather than starting one per import.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">The sync</p>
            <p class="m-0 text-meta text-muted-foreground">A second loop, every half minute, with a busy flag so a slow pass never overlaps the next. Two requests per project per pass: one GraphQL query for the board’s items and one REST call for the open issues carrying the label. A rate-limit reply pauses it until the reset the reply names.</p>
          </div>
        </div>

        <hr class="my-12 border-0 border-t border-border" />

        <h3 class=${H3}>Why the table is the queue</h3>
        <p class=${cn(PROSE, 'mt-3')}>
          A task’s status is the queue position. Three stages are Genie’s to drive, and a row in one of them with no error recorded is work. A stage that fails keeps its status and records the error, so the card stays in the column it failed in with a Retry button, instead of moving to a failed column nobody looks at. The candidate query is the whole scheduler:
        </p>
        <pre class=${cn(MONO_BLOCK, 'mt-6 max-w-[62ch]')}>status in (todo, planning, in_progress)
and error is null
and (claimed_at is null or claimed_at is stale)
order by created_at</pre>
        <p class=${cn(PROSE, 'mt-6')}>
          Claiming is writing the clock into the row and bumping its attempt. A claim older than the stage’s budget belongs to a process that died, and the row is claimable again. Finishing a stage is one function that checks the state machine, writes the new status, clears the claim, records the feed line, pushes the board over the socket and mirrors the move to GitHub. Nothing else in the codebase changes a status.
        </p>`,
    })}

    ${section({
      id: 'github',
      heading: 'GitHub is a mirror, and a label is the switch',
      lede: 'Genie keeps its own database as the truth and treats GitHub as a view of it that people also write to. Only an issue carrying the genie label is ever imported, moved or commented on, so a board can hold any number of human-only cards and Genie never touches them.',
      body: html`
        <div class="grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>Out: after every move</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              A task written in the dashboard becomes a labelled issue at once, with a hidden marker naming the task so a retry links instead of duplicating. Every transition moves the card, and reaching Review or Done posts a comment with the pull request, the preview and the verdict instructions. Every comment Genie writes opens with a marker, because it posts with the same token the reviewer uses and the marker is the only thing that tells its writes from a person’s.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>In: on a timer</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              Each pass reads the board’s items and the open labelled issues, imports a labelled issue that sits in Todo with no task behind it, re-asserts any card that drifted out of a Genie-owned column, and applies a verdict found on a card in Review. For tasks in Review it also reads the pull request’s reviews and comments, one request per task, because a verdict can be given there too.
            </p>
          </div>
        </div>

        <div class="mt-12 overflow-x-auto">
          <table class="w-full min-w-[640px] border-collapse text-body">
            <caption class="sr-only">Each column, who owns it, and what the sync does when the board and the database disagree</caption>
            <thead>
              <tr class="border-b border-border-strong text-left">
                <th scope="col" class=${cn(fieldLabelClass(), 'py-3 pr-6 font-medium')}>Column</th>
                <th scope="col" class=${cn(fieldLabelClass(), 'py-3 pr-6 font-medium')}>Owner</th>
                <th scope="col" class=${cn(fieldLabelClass(), 'py-3 font-medium')}>What the sync does</th>
              </tr>
            </thead>
            <tbody>
              ${OWNERSHIP.map(
                ([column, owner, does]) => html`
                  <tr class="border-b border-border align-top">
                    <td class="whitespace-nowrap py-4 pr-6 font-semibold">${column}</td>
                    <td class="whitespace-nowrap py-4 pr-6 text-muted-foreground">${owner}</td>
                    <td class="py-4 text-muted-foreground">${does}</td>
                  </tr>
                `,
              )}
            </tbody>
          </table>
        </div>

        <p class=${cn(PROSE, 'mt-8')}>
          The budget is deliberate. A GitHub Project has no REST API and its GraphQL is scored in points from a separate hourly pool, so the board query fetches only item ids, the status option and the issue number, and everything else comes from REST where a request costs one. Labels and bodies are never fetched through GraphQL, and a board past the first page reads the first page and records a warning once.
        </p>`,
    })}

    ${section({
      id: 'machine',
      layout: 'split',
      heading: 'A machine per task, forked rather than booted',
      lede: 'A base machine named genie-base is built once with git, gh, Claude Code and the WebJs scaffolder on it, then checkpointed. Every task machine is a fork of that checkpoint, so it is answering before the plan is written, and it is sized, named and found by the task it belongs to.',
      body: html`
        <div class="grid gap-5 md:grid-cols-3">
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">The base stays alive</p>
            <p class="m-0 text-meta text-muted-foreground">Destroying a machine on Pilots deletes its checkpoints, so the base is never destroyed. Suspended, it costs nothing. Its checkpoint id lives in Genie’s settings table, and a fork that finds it gone rebuilds the base once and forks again.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">The fork carries no labels</p>
            <p class="m-0 text-meta text-muted-foreground">A fork copies the base’s size and nothing else, so a task machine is found by the id and the name stored on the task row, never by a label. The name is the repository’s slug and the first characters of the task id, which keeps it a valid DNS label.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">One process holds the tokens</p>
            <p class="m-0 text-meta text-muted-foreground">The Claude token and the GitHub token ride as the environment of one buffered exec that runs a launcher, and the launcher execs Claude Code. The prompt goes in as a file. Nothing is granted to the machine for its lifetime, and nothing is on its disk.</p>
          </div>
        </div>
        <p class=${cn(PROSE, 'mt-8')}>
          Claude Code writes its stream to a log file inside the machine, and a poller tails only the new bytes every few seconds and turns each assistant message and each tool call into a line on the card, so a person can watch a build from the dashboard without a terminal. Every line passes through a redactor that knows the token values before it is stored, because git prints the rewritten remote on an error and gh can echo a token in a refusal.
        </p>`,
    })}

    ${section({
      id: 'pipeline',
      heading: 'Plan, build, self-review, and the pull request is the deliverable',
      lede: 'A task Genie owns passes through three stages the worker drives, and everything the agent does happens on a branch inside the task machine. The card reaches Review only when a pull request exists, it has been reviewed once by the agent, and there is a URL a person can open.',
      body: html`
        <ol class="m-0 flex list-none flex-col p-0">
          ${STAGES.map(
            ([title, body], i) => html`
              <li class=${cn('grid grid-cols-[2rem_1fr] gap-4 py-5', i > 0 && 'border-t border-border')}>
                <span class="font-mono text-meta text-muted-foreground">${i + 1}</span>
                <div>
                  <p class="m-0 font-semibold">${title}</p>
                  <p class="m-0 mt-1 max-w-[70ch] text-meta text-muted-foreground">${body}</p>
                </div>
              </li>
            `,
          )}
        </ol>

        <hr class="my-12 border-0 border-t border-border" />

        <h3 class=${H3}>The stack rule</h3>
        <p class=${cn(PROSE, 'mt-3')}>
          The plan’s first section names one of three branches, so the build and a human reviewer both see the call before any code exists.
        </p>
        <div class="mt-6 grid gap-5 md:grid-cols-3">
          <div class=${cn(cardClass(), 'p-5')}>
            <span class=${fieldLabelClass()}>An existing app</span>
            <p class="m-0 mt-2 text-meta text-muted-foreground">Its own stack, whatever it is. The agent reads the conventions file, the manifest and the README, and runs that app’s own checks. WebJs is never introduced into a repository that did not have it.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <span class=${fieldLabelClass()}>An empty repository</span>
            <p class="m-0 mt-2 text-meta text-muted-foreground">Probed, not trusted to the plan: no manifest and only a handful of tracked files. Genie itself scaffolds WebJs at the repository root and commits the scaffold as its own first commit, and the agent builds the task on top of it.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <span class=${fieldLabelClass()}>A new app in a monorepo</span>
            <p class="m-0 mt-2 text-meta text-muted-foreground">The build run scaffolds WebJs in the directory the plan names, respecting the workspace layout and package manager already there, commits the scaffold first, then builds the task on it.</p>
          </div>
        </div>
        <p class=${cn(PROSE, 'mt-8')}>
          The root and not a subdirectory for an empty repository, because the Pilots GitHub App builds the repository root and a nested app would never get a preview.
        </p>`,
    })}

    ${section({
      id: 'review',
      layout: 'split',
      heading: 'Approve merges, and the platform deploys',
      lede: 'A card in Review is waiting for one of two verdicts, and there are five ways to give them. Approve squash-merges the pull request first and only then moves the card. Request changes sends the same task back to the same branch, the same machine and the same pull request.',
      body: html`
        <div class="grid gap-10 lg:grid-cols-2">
          <div class="min-w-0">
            <h3 class=${H3}>Approve is a merge, then a move</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              The merge is a squash over the API with the branch deleted. If it is refused, nothing moves: the card stays in Review with the reason shown, and there is no failed badge because a person, not a stage, is the one to act. On success the card goes to Done, the preview URL is cleared because the platform destroys the preview when the pull request closes, and the production URL is read from the Pilots services list. Genie does not deploy anything. A push to the default branch is the platform’s to build and ship.
            </p>
          </div>
          <div class="min-w-0">
            <h3 class=${H3}>Request changes is a revise round</h3>
            <p class=${cn(PROSE, 'mt-3')}>
              The feedback is stored as the one pending instruction, the card returns to In progress, and the build stage takes its revise path: the same machine, the same branch, a run that receives the feedback and, for a review, the unresolved threads, then a push. The preview poll then waits for the preview of the new head commit and not the previous round’s, since the URL is the same and only the commit tells rounds apart. The feedback is cleared on success only, so a revise that fails retries with the same instruction.
            </p>
          </div>
        </div>

        <hr class="my-12 border-0 border-t border-border" />

        <h3 class=${H3}>Five ways to give a verdict</h3>
        <ul class="m-0 mt-2 list-none border-t border-border p-0">
          ${VERDICTS.map(
            ([title, body]) => html`
              <li class="grid gap-x-6 gap-y-1 border-b border-border py-4 md:grid-cols-[16rem_1fr]">
                <span class="font-semibold">${title}</span>
                <span class="text-meta text-muted-foreground">${body}</span>
              </li>
            `,
          )}
        </ul>
        <p class=${cn(PROSE, 'mt-8')}>
          All five reach the same two functions, so the merge and the feedback handling exist once. Retry, the third button, is for a failed stage only: it clears the error, the claim and the attempt count and the worker re-claims the row where it stands, on the same machine.
        </p>`,
    })}

    ${section({
      id: 'redeploy',
      heading: 'A redeploy is a power cut, and the design assumes one',
      lede: 'On Pilots a volume-backed service is one replica, redeployed in place by stopping its microVM from the host, so nothing inside Genie ever sees a shutdown signal. Recovery is therefore designed for the next boot, not for the last breath of the old process.',
      body: html`
        <div class="grid gap-5 md:grid-cols-3">
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">At boot, every claim is released</p>
            <p class="m-0 text-meta text-muted-foreground">One replica means no other live claimant, so every claim found at boot belongs to a process that no longer exists. The worker clears them before its first tick and writes one feed line per interrupted task saying so.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">The first tick resumes them</p>
            <p class="m-0 text-meta text-muted-foreground">Each interrupted task is re-claimed at once under the same rules a retry uses: the machine is reused while it answers, the branch while it exists, the pull request while one is open. The agent process on the task machine was never stopped, and its log is still there.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <p class="m-0 mb-1.5 font-semibold">Stale windows are for silence, not restarts</p>
            <p class="m-0 text-meta text-muted-foreground">Where a platform does deliver a signal, in docker compose, in dev and in CI, the worker stops claiming and drains for a few seconds first. The per-stage stale windows are only ever waited out when the process keeps running but a stage hangs.</p>
          </div>
        </div>
        <p class=${cn(PROSE, 'mt-8')}>
          The database survives the cut because SQLite in write-ahead mode is crash-safe by design, and the connection’s busy timeout is what lets the new process’s first write succeed against the file the old one held.
        </p>`,
    })}

    ${section({
      id: 'costs',
      layout: 'split',
      heading: 'What this design costs',
      lede: 'Choosing one process, one file and a polled mirror is not free. These are the bills it comes with, and they are structural rather than temporary.',
      body: html`
        <div class="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-2">
          ${COSTS.map(
            ([title, body]) => html`
              <div class="bg-card p-5">
                <p class="m-0 mb-1.5 font-semibold">${title}</p>
                <p class="m-0 text-meta text-muted-foreground">${body}</p>
              </div>
            `,
          )}
        </div>
        <p class=${cn(PROSE, 'mt-10')}>
          If this is the kind of thing you want to argue with, the plans are written down in full in the repository’s issues and the code is next to them. <a href="/architecture/internals">The internals page</a> draws all of it, one mechanism at a time.
        </p>
        <p class="m-0 mt-6 max-w-[62ch] text-meta text-muted-foreground">
          <span class=${fieldLabelClass()}>Status</span>
          <span class="ml-2">The first milestone, the app with its board and worker, is built. The GitHub layer, the Pilots layer, the pipeline, the review loop, the hardening and the deploy are planned in the repository’s issues and land one milestone at a time.</span>
        </p>`,
    })}
  `;
}
