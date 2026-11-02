import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { textareaClass } from '#components/ui/textarea.ts';
import { cn } from '#lib/utils/cn.ts';
import { formFailure } from '#lib/utils/form.ts';
import { approveTask } from '#modules/tasks/actions/approve-task.server.ts';
import { deleteTask } from '#modules/tasks/actions/delete-task.server.ts';
import { requestChanges } from '#modules/tasks/actions/request-changes.server.ts';
import { retryTask } from '#modules/tasks/actions/retry-task.server.ts';
import { stopTask } from '#modules/tasks/actions/stop-task.server.ts';
import { getTask } from '#modules/tasks/queries/get-task.server.ts';
import { listEvents } from '#modules/tasks/queries/list-events.server.ts';
import { canDelete, canStop, STOPPED } from '#modules/tasks/utils/state-machine.ts';
import { feedLine } from '#modules/tasks/utils/ui/feed-line.ts';
import { statusBadge } from '#modules/tasks/utils/ui/status-badge.ts';
import type { CiStatus } from '#modules/tasks/types.ts';
import '#modules/tasks/components/live-refresh.ts';

const CI: Record<CiStatus, { label: string; tone: string }> = {
  passing: { label: 'CI is green', tone: 'text-success' },
  failing: { label: 'CI is still failing after Genie tried to fix it', tone: 'text-destructive' },
  pending: { label: 'CI was still running when Genie stopped waiting', tone: 'text-muted-foreground' },
  none: { label: 'This repository ran no CI checks', tone: 'text-muted-foreground' },
};

export async function generateMetadata({ params }: PageProps<'/projects/[id]/tasks/[tid]'>) {
  const task = await getTask(params.tid);
  return { title: task ? task.title : 'Task' };
}

// Everything that changes lives in one frame. It only refreshes while Genie is
// working, and the review form only exists while it is not, so a refresh never
// takes text out of the box.
export default async function TaskDetail({ params, actionData }: PageProps<'/projects/[id]/tasks/[tid]'>) {
  const task = await getTask(params.tid);
  if (!task || task.projectId !== params.id) notFound();
  const events = await listEvents(task.id);
  const failed = formFailure(actionData);
  return html`
    <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div class="flex items-center justify-between gap-3">
        <a href="/projects/${task.projectId}" class="text-sm text-muted-foreground no-underline hover:text-foreground">Back to the board</a>
        <live-refresh project-id=${task.projectId} task-id=${task.id} frame="task"></live-refresh>
      </div>
      <webjs-frame id="task" class="mt-4 block">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <h1 class="m-0 min-w-0 break-words text-h2 font-bold" style="font-family: var(--font-display)">${task.title}</h1>
          ${statusBadge(task)}
        </div>
        ${task.description ? html`<p class="m-0 mt-3 whitespace-pre-wrap text-muted-foreground">${task.description}</p>` : ''}
        ${task.prUrl ? html`<p class="m-0 mt-3 text-sm"><a href=${task.prUrl} target="_blank" rel="noopener" class="font-medium text-primary underline-offset-4 hover:underline">Pull request #${task.prNumber}</a> <span class="font-mono text-xs text-muted-foreground">${task.branch}</span></p>` : ''}
        ${task.ciStatus ? html`<p class=${cn('m-0 mt-1 text-sm', CI[task.ciStatus].tone)}>${CI[task.ciStatus].label}</p>` : ''}
        ${task.previewUrl && task.status !== 'done' ? html`<p class="m-0 mt-1 text-sm"><a href=${task.previewUrl} target="_blank" rel="noopener" class="font-medium text-primary underline-offset-4 hover:underline">Open the preview</a></p>` : ''}

        ${failed.error ? html`<p role="alert" class="m-0 mt-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">${failed.error}</p>` : ''}

        ${task.error ? html`
          <div class=${cn('mt-4 rounded-xl border p-4', task.error === STOPPED ? 'border-border bg-card' : 'border-destructive/40 bg-destructive/10')}>
            <p class=${cn('m-0 whitespace-pre-wrap break-words text-sm', task.error === STOPPED ? 'text-muted-foreground' : 'text-destructive')}>${task.error}</p>
            <form action=${retryTask} class="m-0 mt-3">
              <input type="hidden" name="taskId" value=${task.id}>
              <button type="submit" class=${buttonClass({ size: 'sm' })}>Retry</button>
            </form>
          </div>` : ''}

        ${task.status === 'review' ? html`
          <div class="mt-4 rounded-xl border border-border bg-card p-4 shadow-xs">
            <form action=${approveTask} class="m-0">
              <input type="hidden" name="taskId" value=${task.id}>
              <button type="submit" class=${buttonClass(task.ciStatus === 'failing' ? { variant: 'destructive' } : {})}>${task.ciStatus === 'failing' ? 'Merge with failing CI' : 'Approve and merge'}</button>
            </form>
            <form action=${requestChanges} class="m-0 mt-4">
              <input type="hidden" name="taskId" value=${task.id}>
              <label for="feedback" class="mb-1.5 block text-sm font-medium">Or ask for changes</label>
              <textarea id="feedback" name="feedback" required rows="3" placeholder="What should be different?" class=${textareaClass()}></textarea>
              ${failed.fieldErrors?.feedback ? html`<p role="alert" class="m-0 mt-1 text-sm text-destructive">${failed.fieldErrors.feedback}</p>` : ''}
              <button type="submit" class=${cn(buttonClass({ variant: 'outline' }), 'mt-2')}>Request changes</button>
            </form>
          </div>` : ''}

        <section class="mt-6 overflow-hidden rounded-xl border border-border bg-card shadow-xs" aria-label="Activity">
          <h2 class="m-0 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Activity</h2>
          <ol class="m-0 flex max-h-[32rem] list-none flex-col-reverse overflow-y-auto p-0 py-2 font-mono text-xs leading-relaxed">
            ${events.map(feedLine)}
          </ol>
        </section>

        <div class="mt-4 flex gap-2">
          ${canStop(task) ? html`
            <form action=${stopTask} class="m-0">
              <input type="hidden" name="taskId" value=${task.id}>
              <button type="submit" class=${buttonClass({ variant: 'outline', size: 'sm' })}>Stop</button>
            </form>` : ''}
          ${canDelete(task) ? html`
            <form action=${deleteTask} data-webjs-frame="_top" class="m-0">
              <input type="hidden" name="taskId" value=${task.id}>
              <button type="submit" class=${buttonClass({ variant: 'ghost', size: 'sm' })}>${task.prNumber ? 'Remove from the board (the pull request stays on GitHub)' : 'Delete this task'}</button>
            </form>` : ''}
        </div>
      </webjs-frame>
    </div>
  `;
}
