import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { inputClass } from '#components/ui/input.ts';
import { textareaClass } from '#components/ui/textarea.ts';
import { cn } from '#lib/utils/cn.ts';
import { formFailure } from '#lib/utils/form.ts';
import { disconnectProject } from '#modules/projects/actions/disconnect-project.server.ts';
import { getProject } from '#modules/projects/queries/get-project.server.ts';
import { createTask } from '#modules/tasks/actions/create-task.server.ts';
import { listBoard } from '#modules/tasks/queries/list-board.server.ts';
import { groupByColumn } from '#modules/tasks/utils/state-machine.ts';
import { taskCard } from '#modules/tasks/utils/ui/task-card.ts';
import '#modules/tasks/components/live-refresh.ts';

export async function generateMetadata({ params }: PageProps<'/projects/[id]'>) {
  const project = await getProject(params.id);
  return { title: project ? project.githubRepo : 'Project' };
}

// The composer stays outside the frame, so a live refresh never wipes what is
// being typed. The board inside the frame swaps on its own.
export default async function Board({ params, actionData }: PageProps<'/projects/[id]'>) {
  const project = await getProject(params.id);
  if (!project) notFound();
  const columns = groupByColumn(await listBoard(project.id));
  const failure = formFailure(actionData);
  const titleError = failure.fieldErrors?.title ?? failure.error;
  return html`
    <div class="mx-auto max-w-[88rem] px-4 py-8 sm:px-6">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <a href="https://github.com/${project.githubRepo}" target="_blank" rel="noopener" class="truncate font-mono text-sm text-muted-foreground no-underline hover:text-foreground">${project.githubRepo}</a>
        <div class="flex items-center gap-3">
          <live-refresh project-id=${project.id} frame="board"></live-refresh>
          <form action=${disconnectProject} data-webjs-frame="_top" class="m-0">
            <input type="hidden" name="projectId" value=${project.id}>
            <button type="submit" class=${cn(buttonClass({ variant: 'ghost', size: 'xs' }), 'text-muted-foreground')}>Disconnect</button>
          </form>
        </div>
      </div>

      <form action=${createTask} class="mt-4 rounded-xl border border-border bg-card p-3 shadow-xs">
        <input type="hidden" name="projectId" value=${project.id}>
        <div class="flex flex-col gap-2 sm:flex-row">
          <label for="title" class="sr-only">What should Genie do?</label>
          <input id="title" name="title" required maxlength="200" autocomplete="off" placeholder="What should Genie do next?" class=${cn(inputClass(), 'h-10 flex-1 text-base')}>
          <button type="submit" class=${cn(buttonClass(), 'h-10 px-5')}>Add to backlog</button>
        </div>
        <details class="mt-2">
          <summary class="cursor-pointer select-none text-xs text-muted-foreground hover:text-foreground">Add details</summary>
          <label for="description" class="sr-only">Details</label>
          <textarea id="description" name="description" rows="3" placeholder="Anything that helps: where it lives, how it should behave, what done looks like." class=${cn(textareaClass(), 'mt-2')}></textarea>
        </details>
        ${titleError ? html`<p role="alert" class="m-0 mt-2 text-sm text-destructive">${titleError}</p>` : ''}
      </form>

      <webjs-frame id="board" class="mt-6 block">
        <div class="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          ${columns.map((column) => html`
            <section class="flex min-h-64 flex-col gap-2 rounded-xl border border-border bg-muted/60 p-2.5" aria-label=${column.label}>
              <header class="flex items-baseline justify-between px-1 pb-1">
                <h2 class="m-0 text-xs font-semibold uppercase tracking-wider text-muted-foreground">${column.label}</h2>
                <span class="text-xs tabular-nums text-muted-foreground">${column.tasks.length}</span>
              </header>
              ${column.tasks.length === 0
                ? html`<p class="m-0 px-1 text-sm text-muted-foreground/80">${column.hint}</p>`
                : column.tasks.map(taskCard)}
            </section>`)}
        </div>
      </webjs-frame>
    </div>
  `;
}
