import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { inputClass } from '#components/ui/input.ts';
import { textareaClass } from '#components/ui/textarea.ts';
import { fieldError, formLabel, pageHeading } from '#lib/utils/ui.ts';
import { getProject } from '#modules/projects/queries/get-project.server.ts';
import { createTask } from '#modules/tasks/actions/create-task.server.ts';
import { listBoard } from '#modules/tasks/queries/list-board.server.ts';
import { groupByColumn } from '#modules/tasks/utils/state-machine.ts';
import { taskCard } from '#modules/tasks/utils/ui/task-card.ts';
import '#modules/tasks/components/live-refresh.ts';

interface BoardProps extends PageProps<'/projects/[id]'> {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
}

export async function generateMetadata({ params }: PageProps<'/projects/[id]'>) {
  const project = await getProject(params.id);
  return { title: project ? project.name : 'Project' };
}

export default async function Board({ params, actionData }: BoardProps) {
  const project = await getProject(params.id);
  if (!project) notFound();
  const columns = groupByColumn(await listBoard(project.id));
  const errors = actionData?.fieldErrors ?? {};
  const values = actionData?.values ?? {};
  return html`
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        ${pageHeading(project.name)}
        <p class="m-0 mt-1 text-sm text-muted-foreground">
          <a href="https://github.com/${project.githubRepo}" target="_blank" rel="noopener" class="text-muted-foreground hover:text-foreground">${project.githubRepo}</a>
          ${project.githubProjectNumber ? html` · <a href="https://github.com/${project.githubRepo.split('/')[0]}/projects/${project.githubProjectNumber}" target="_blank" rel="noopener" class="text-muted-foreground hover:text-foreground">board #${project.githubProjectNumber}</a>` : ''}
          ${project.productionUrl ? html` · <a href=${project.productionUrl} target="_blank" rel="noopener">production</a>` : ''}
        </p>
      </div>
      <live-refresh project-id=${project.id} frame="board"></live-refresh>
    </div>

    <form action=${createTask} class="mt-6 grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
      <input type="hidden" name="projectId" value=${project.id}>
      <div>
        ${formLabel('New task', 'title')}
        <input id="title" name="title" class=${inputClass()} placeholder="Add a /about page" value=${values.title ?? ''} required>
        ${fieldError(errors.title)}
      </div>
      <div>
        ${formLabel('What should genie build?', 'description')}
        <textarea id="description" name="description" rows="1" class=${textareaClass()} placeholder="Acceptance criteria, links, anything the agent should know">${values.description ?? ''}</textarea>
      </div>
      <button type="submit" class=${buttonClass()}>Add to Todo</button>
    </form>

    <webjs-frame id="board" class="mt-6 block">
      <div class="grid gap-4 md:grid-cols-5">
        ${columns.map((column) => html`
          <section class="flex min-h-40 flex-col gap-2 rounded-xl bg-muted/60 p-3" aria-label=${column.label}>
            <header class="flex items-baseline justify-between px-1">
              <h2 class="m-0 text-sm font-semibold">${column.label}</h2>
              <span class="text-xs text-muted-foreground">${column.tasks.length}</span>
            </header>
            ${column.tasks.length === 0
              ? html`<p class="m-0 px-1 text-xs text-muted-foreground">${column.hint}</p>`
              : column.tasks.map(taskCard)}
          </section>
        `)}
      </div>
    </webjs-frame>
  `;
}
