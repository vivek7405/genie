import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { ledgerClass, ledgerRowClass, pageHeader, sectionEmpty, liveDot } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';
import { listProjectSummaries } from '#modules/projects/queries/list-project-summaries.server.ts';
import { labelOf } from '#modules/tasks/utils/state-machine.ts';

export const metadata = { title: 'Projects' };

// The list of connected projects: one row per project in a hairline ledger,
// with what is happening on its board. The connect form has its own page.
export default async function Home() {
  const rows = await listProjectSummaries();
  return html`
    ${pageHeader({
      title: 'Projects',
      lede: 'A project is a GitHub repository genie builds on. Open one to see its board, or connect a new one.',
      actions: html`<a href="/dashboard/projects/new" class=${cn(buttonClass({ size: 'sm' }), 'no-underline')}>Connect a repo</a>`,
    })}
    ${rows.length === 0
      ? sectionEmpty('No projects yet', { text: 'Connect a repository to get a board.', href: '/dashboard/projects/new' })
      : html`
        <ul class=${ledgerClass()}>
          ${rows.map(({ project, counts, total }) => {
            const busy = counts.planning + counts.in_progress;
            return html`
              <li class=${cn(ledgerRowClass(), 'sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.8fr)_max-content]')}>
                <h2 class="m-0 flex min-w-0 items-baseline gap-2 text-body font-semibold">
                  <a href="/dashboard/projects/${project.id}" class="truncate text-foreground no-underline">${project.name}</a>
                  <span class="shrink-0 font-mono text-label font-normal uppercase tracking-[0.12em] text-muted-foreground">${project.githubRepo}</span>
                </h2>
                <p class="m-0 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta text-muted-foreground">
                  ${liveDot(busy > 0, busy > 0 ? 'genie is working' : 'idle')}
                  ${total === 0 ? 'no tasks yet' : html`${counts.ready_for_review > 0 ? html`<span class="text-foreground">${counts.ready_for_review} ${labelOf('ready_for_review').toLowerCase()}</span>` : ''}
                    ${busy > 0 ? html`<span>${busy} in flight</span>` : ''}
                    <span>${counts.todo} todo</span><span>${counts.done} done</span>`}
                </p>
                <p class="m-0 text-meta text-muted-foreground sm:text-right">${project.githubProjectNumber ? html`board #${project.githubProjectNumber}` : 'no board linked'}</p>
              </li>
            `;
          })}
        </ul>
      `}
  `;
}
