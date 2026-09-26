import { html } from '@webjsdev/core';
import { badgeClass } from '#components/ui/badge.ts';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { fieldLabelClass, liveDot, proseClass } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';

// The home page. One argument, carried by the section ledes:
//   hero      write the task, come back to a pull request with a preview
//   loop      the four steps, and who owns which
//   sandbox   every task gets its own computer, and nothing of yours is on it
//   stack     it speaks the repository's language; WebJs only for a new app
//   built     the two open-source pieces underneath
// Every section stands alone: a reader arriving mid-page from a link must be
// able to read a heading and its first sentence with nothing above it.

const H2 = 'm-0 text-title font-bold tracking-tight';
const PROSE = cn(proseClass(), 'text-body');
const VOICE = 'font-mono text-label uppercase tracking-[0.12em]';

function section(opts: { id: string; heading: string; layout?: 'stacked' | 'split'; lede?: unknown; body: unknown }) {
  return html`
    <section id=${opts.id} class="scroll-mt-24 border-t border-border py-16 md:py-24">
      <div class="mx-auto max-w-6xl px-4 sm:px-6">
        ${opts.layout === 'split' && opts.lede
          ? html`<div class="grid gap-6 lg:grid-cols-2 lg:items-end lg:gap-14"><h2 class=${cn(H2, 'max-w-[20ch]')}>${opts.heading}</h2><p class=${cn(PROSE, 'm-0 lg:pb-1')}>${opts.lede}</p></div>`
          : html`<h2 class=${H2}>${opts.heading}</h2>${opts.lede ? html`<p class=${cn(PROSE, 'mt-4 text-heading')}>${opts.lede}</p>` : ''}`}
        <div class="mt-10">${opts.body}</div>
      </div>
    </section>
  `;
}

/** The hero's artifact: one card's activity feed, as the dashboard prints it. */
function heroFeed() {
  const lines: [string, string, 'status' | 'log' | 'glow'][] = [
    ['09:41:02', 'Created in Todo', 'status'],
    ['09:41:04', 'Todo to Planning', 'status'],
    ['09:41:11', 'Sandbox shop-a3f2 forked from the base image', 'log'],
    ['09:41:15', 'Cloned acme/shop, read AGENTS.md and the tests', 'log'],
    ['09:43:40', 'Plan posted to acme/shop#42', 'log'],
    ['09:43:41', 'Planning to In progress', 'status'],
    ['09:52:08', 'Branch genie/42-about-page pushed, 3 commits', 'log'],
    ['09:52:20', 'Pull request #43 opened', 'log'],
    ['09:54:31', 'Preview ready at pr-43-shop.pilotrun.app', 'log'],
    ['09:54:32', 'In progress to Ready for review', 'glow'],
  ];
  return html`
    <div class=${cn(cardClass(), 'overflow-hidden')}>
      <div class="flex items-center gap-3 border-b border-border px-4 py-3">
        <span class="min-w-0 truncate text-body font-semibold">Add a /about page with the team</span>
        <span class=${cn(badgeClass(), VOICE, 'ml-auto shrink-0')}>Ready for review</span>
      </div>
      <ol class="m-0 grid list-none gap-1.5 p-4 font-mono text-meta">
        ${lines.map(([t, m, k]) => html`
          <li class=${cn('flex gap-3', k === 'log' ? 'text-muted-foreground' : 'text-foreground')}>
            <span class="shrink-0 tabular-nums text-muted-foreground">${t}</span>
            <span class="min-w-0 break-words">${k === 'glow' ? html`<span class="inline-flex items-center gap-2">${liveDot(true)}${m}</span>` : m}</span>
          </li>
        `)}
      </ol>
      <div class="grid grid-cols-[max-content_1fr] gap-x-5 gap-y-2 border-t border-border px-4 py-3 text-meta">
        <span class=${fieldLabelClass()}>Pull request</span><span>acme/shop#43</span>
        <span class=${fieldLabelClass()}>Preview</span><span class="font-mono">pr-43-shop.pilotrun.app</span>
      </div>
    </div>
  `;
}

const STEPS = [
  { n: '01', owner: 'you', title: 'Write the task', text: 'In genie, or as a card on your GitHub project board with the genie label. A title and a brief, the way you would hand it to a colleague.' },
  { n: '02', owner: 'genie', title: 'Plan', text: 'A short, timeboxed run reads the brief and the repository and writes a plan: the files to touch, the steps, the checks. It is posted on the issue before any code.' },
  { n: '03', owner: 'genie', title: 'Build', text: 'On a branch, in a sandbox of its own. The agent follows the repository’s conventions, runs its checks and tests, commits per logical unit and opens the pull request.' },
  { n: '04', owner: 'you', title: 'Review', text: 'The card arrives in Ready for review with the PR and a live preview URL. Approve to merge, or send it back with a note and it revises on the same branch.' },
];

const COLUMNS = [
  { label: 'Todo', owner: 'you' },
  { label: 'Planning', owner: 'genie' },
  { label: 'In progress', owner: 'genie' },
  { label: 'Ready for review', owner: 'genie' },
  { label: 'Done', owner: 'you' },
];

export default function Home() {
  return html`
    <div class="border-b border-border">
      <div class="mx-auto max-w-6xl px-4 pb-16 pt-14 sm:px-6 md:pb-24 md:pt-20">
        <div class="grid gap-12 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-14">
          <div>
            <h1 class="m-0 text-[2.4rem] font-bold leading-[1.02] tracking-tight sm:text-[3.2rem]">Write the task. Review the pull request.</h1>
            <p class=${cn(PROSE, 'mt-6 text-heading')}>
              genie is an async project manager that ships. Connect a repository, put a card in Todo, and come back to a branch, a pull request and a live preview waiting for your verdict.
            </p>
            <div class="mt-8 flex flex-wrap gap-3">
              <a class=${cn(buttonClass(), 'no-underline')} href="/dashboard" data-no-router>Open the dashboard</a>
              <a class=${cn(buttonClass({ variant: 'outline' }), 'no-underline')} href="#loop">How it works</a>
            </div>
            <p class="mt-6 text-meta text-muted-foreground">Open source. Built with WebJs, runs its sandboxes on pilots.</p>
          </div>
          <div class="lg:pl-4">${heroFeed()}</div>
        </div>
      </div>
    </div>

    ${section({
      id: 'loop',
      heading: 'Four steps, and you only do two of them',
      lede: 'A task moves across the board on its own. You write it and you judge it; genie plans it, builds it and hands it back as a pull request. Nothing in the middle waits for a person.',
      body: html`
        <ol class="m-0 grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-4">
          ${STEPS.map((s) => html`
            <li class=${cn(cardClass(), 'flex flex-col gap-3 p-5')}>
              <div class="flex items-baseline justify-between">
                <span class="font-mono text-heading font-semibold tabular-nums">${s.n}</span>
                <span class=${cn(VOICE, s.owner === 'you' ? 'text-foreground' : 'text-muted-foreground')}>${s.owner}</span>
              </div>
              <h3 class="m-0 text-heading font-semibold">${s.title}</h3>
              <p class="m-0 text-meta text-muted-foreground">${s.text}</p>
            </li>
          `)}
        </ol>
        <div class="mt-8 grid gap-2 md:grid-cols-5">
          ${COLUMNS.map((c) => html`
            <div class="rounded-md bg-muted/60 px-3 py-2.5">
              <div class=${cn(VOICE, 'text-foreground')}>${c.label}</div>
              <div class="mt-1 text-meta text-muted-foreground">${c.owner === 'you' ? 'yours' : 'genie owns it'}</div>
            </div>
          `)}
        </div>
        <p class=${cn(PROSE, 'mt-6 text-meta')}>Use the GitHub project board if you already live there: cards with the genie label are picked up from Todo, every move is mirrored back, and moving a card to Done or back to In progress is the same verdict as the buttons.</p>`,
    })}

    ${section({
      id: 'sandbox',
      layout: 'split',
      heading: 'Every task gets its own computer',
      lede: 'The agent never runs on your machine or on genie’s. Each task forks a microVM from a base image that already has git, gh and Claude Code on it, does its work there, and leaves nothing behind.',
      body: html`
        <div class="grid gap-5 md:grid-cols-3">
          <div class=${cn(cardClass(), 'p-5')}><p class="m-0 mb-1.5 font-semibold">Forked, not booted</p><p class="m-0 text-meta text-muted-foreground">A sandbox is restored from a checkpoint, so it is answering before the plan is written. Idle ones suspend and cost nothing.</p></div>
          <div class=${cn(cardClass(), 'p-5')}><p class="m-0 mb-1.5 font-semibold">Credentials never touch disk</p><p class="m-0 text-meta text-muted-foreground">The Claude and GitHub tokens ride as the environment of one process inside the machine. A snapshot or a fork carries nothing.</p></div>
          <div class=${cn(cardClass(), 'p-5')}><p class="m-0 mb-1.5 font-semibold">The preview is the platform’s</p><p class="m-0 text-meta text-muted-foreground">A connected repository gets a preview URL on every pull request and a deploy on merge from pilots, so genie never deploys anything itself.</p></div>
        </div>`,
    })}

    ${section({
      id: 'stack',
      heading: 'It speaks your repository’s language',
      lede: 'A task on an existing app follows that app: its framework, its package manager, its checks, its conventions file. genie reads AGENTS.md before it reads anything else.',
      body: html`
        <div class="grid gap-5 md:grid-cols-2">
          <div class=${cn(cardClass(), 'p-5')}>
            <span class=${fieldLabelClass()}>An existing app</span>
            <p class="m-0 mt-2 text-body">Go, Rails, Django, Next, whatever is there. The plan names the stack on its first line so the reviewer sees the call, and the build runs the project’s own tests before it opens the pull request.</p>
          </div>
          <div class=${cn(cardClass(), 'p-5')}>
            <span class=${fieldLabelClass()}>A new app</span>
            <p class="m-0 mt-2 text-body">An empty repository, or a new web app inside a monorepo, is scaffolded with WebJs: no build step, server-rendered, a design system from the first commit. The scaffold lands as its own commit before the task is built on it.</p>
          </div>
        </div>`,
    })}

    ${section({
      id: 'built',
      layout: 'split',
      heading: 'Two open-source pieces underneath',
      lede: 'genie is a small WebJs app with a SQLite queue and a worker. The heavy lifting is done by the framework it is built with and the platform it runs on.',
      body: html`
        <div class="grid gap-5 md:grid-cols-2">
          <a href="https://webjs.dev" target="_blank" rel="noopener" class=${cn(cardClass(), 'block p-5 no-underline transition-colors hover:border-border-strong')}>
            <span class="text-heading font-semibold text-foreground">WebJs</span>
            <p class="m-0 mt-2 text-meta text-muted-foreground">The buildless, server-first framework. Pages are HTML, islands hydrate where they must, frames and WebSockets make the board live with almost no client code.</p>
          </a>
          <a href="https://pilots.run" target="_blank" rel="noopener" class=${cn(cardClass(), 'block p-5 no-underline transition-colors hover:border-border-strong')}>
            <span class="font-mono text-heading font-semibold text-foreground">pilots</span>
            <p class="m-0 mt-2 text-meta text-muted-foreground">Sandboxes and production services on one primitive. A machine per task, a checkpoint to fork from, previews on pull requests and a deploy on merge.</p>
          </a>
        </div>`,
    })}

    <div class="mx-auto max-w-6xl px-4 pb-24 pt-8 sm:px-6">
      <div class="rounded-md border border-border-strong bg-card p-8 md:p-12">
        <h2 class=${cn(H2, 'max-w-[24ch]')}>Put one card in Todo</h2>
        <p class=${cn(PROSE, 'mt-4')}>Connect a repository, write the smallest task you have been putting off, and see what comes back. Approving it is one click.</p>
        <div class="mt-7 flex flex-wrap gap-3">
          <a class=${cn(buttonClass(), 'no-underline')} href="/dashboard" data-no-router>Open the dashboard</a>
          <a class=${cn(buttonClass({ variant: 'outline' }), 'no-underline')} href="https://github.com/vivek7405/genie" target="_blank" rel="noopener">Read the source</a>
        </div>
      </div>
    </div>
  `;
}
