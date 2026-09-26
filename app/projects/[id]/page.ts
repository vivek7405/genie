import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { pageHeader } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';
import { getProject } from '#modules/projects/queries/get-project.server.ts';
import { listBoard } from '#modules/tasks/queries/list-board.server.ts';
import { groupByColumn } from '#modules/tasks/utils/state-machine.ts';
import { taskCard } from '#modules/tasks/utils/ui/task-card.ts';
import '#modules/tasks/components/live-refresh.ts';

export async function generateMetadata({ params }: PageProps<'/projects/[id]'>) {
  const project = await getProject(params.id);
  return { title: project ? project.name : 'Project' };
}

// The board: five columns inside one <webjs-frame>, so a push from the worker
// swaps just the board and the masthead never re-renders.
export default async function Board({ params }: PageProps<'/projects/[id]'>) {
  const project = await getProject(params.id);
  if (!project) notFound();
  const columns = groupByColumn(await listBoard(project.id));
  const owner = project.githubRepo.split('/')[0];
  const link = (href: string, label: unknown) => html`<a href=${href} target="_blank" rel="noopener" class="text-muted-foreground hover:text-foreground">${label}</a>`;
  return html`
    ${pageHeader({
      title: project.name,
      lede: html`<span class="font-mono text-meta">${link(`https://github.com/${project.githubRepo}`, project.githubRepo)}</span>
        ${project.githubProjectNumber ? html`<span class="text-muted-foreground"> · </span>${link(`https://github.com/${owner}/projects/${project.githubProjectNumber}`, html`board #${project.githubProjectNumber}`)}` : ''}
        ${project.productionUrl ? html`<span class="text-muted-foreground"> · </span>${link(project.productionUrl, 'production')}` : ''}`,
      actions: html`
        <live-refresh project-id=${project.id} frame="board" class="mr-2"></live-refresh>
        <a href="/projects/${project.id}/tasks/new" class=${cn(buttonClass({ size: 'sm' }), 'no-underline')}>New task</a>`,
    })}

    <webjs-frame id="board" class="block">
      <div class="grid gap-3 md:grid-cols-5">
        ${columns.map((column) => html`
          <section class="flex min-h-48 flex-col gap-2 rounded-md bg-muted/60 p-2.5" aria-label=${column.label}>
            <header class="flex items-baseline justify-between px-1 pb-1">
              <h2 class="m-0 font-mono text-label uppercase tracking-[0.14em] text-foreground">${column.label}</h2>
              <span class="font-mono text-label tabular-nums text-muted-foreground">${column.tasks.length}</span>
            </header>
            ${column.tasks.length === 0
              ? html`<p class="m-0 px-1 pt-1 text-meta text-muted-foreground">${column.hint}</p>`
              : column.tasks.map(taskCard)}
          </section>
        `)}
      </div>
    </webjs-frame>
  `;
}
