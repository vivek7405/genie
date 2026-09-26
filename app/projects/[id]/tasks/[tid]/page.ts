import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { textareaClass } from '#components/ui/textarea.ts';
import { fieldError, formLabel } from '#lib/utils/ui.ts';
import { getProject } from '#modules/projects/queries/get-project.server.ts';
import { approveTask } from '#modules/tasks/actions/approve-task.server.ts';
import { requestChanges } from '#modules/tasks/actions/request-changes.server.ts';
import { retryTask } from '#modules/tasks/actions/retry-task.server.ts';
import { getTask } from '#modules/tasks/queries/get-task.server.ts';
import { listEvents } from '#modules/tasks/queries/list-events.server.ts';
import { COLUMNS } from '#modules/tasks/utils/state-machine.ts';
import { statusBadge } from '#modules/tasks/utils/ui/status-badge.ts';
import '#modules/tasks/components/live-refresh.ts';

interface CardProps extends PageProps<'/projects/[id]/tasks/[tid]'> {
  actionData?: { fieldErrors?: Record<string, string>; error?: string };
}

export async function generateMetadata({ params }: PageProps<'/projects/[id]/tasks/[tid]'>) {
  const task = await getTask(params.tid);
  return { title: task ? task.title : 'Task' };
}

const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export default async function TaskCard({ params, actionData }: CardProps) {
  const [project, task] = await Promise.all([getProject(params.id), getTask(params.tid)]);
  if (!project || !task || task.projectId !== project.id) notFound();
  const events = await listEvents(task.id);
  const errors = actionData?.fieldErrors ?? {};
  const stepIndex = COLUMNS.findIndex((c) => c.status === task.status);
  return html`
    <a href="/projects/${project.id}" class="text-sm text-muted-foreground no-underline hover:text-foreground">← ${project.name}</a>
    <div class="mt-2 flex flex-wrap items-center justify-between gap-3">
      <h1 class="m-0 text-2xl font-bold tracking-tight">${task.title}</h1>
      <live-refresh project-id=${project.id} frame="task"></live-refresh>
    </div>

    <webjs-frame id="task" class="mt-4 block">
      <ol class="m-0 flex list-none flex-wrap gap-2 p-0 text-xs" aria-label="Pipeline">
        ${COLUMNS.map((c, i) => html`
          <li class="rounded-full border px-2.5 py-1 ${i < stepIndex ? 'border-border text-muted-foreground' : i === stepIndex ? 'border-primary bg-primary text-primary-foreground' : 'border-dashed border-border text-muted-foreground/70'}">${c.label}</li>
        `)}
      </ol>

      <div class="mt-6 grid gap-6 lg:grid-cols-[1fr_360px]">
        <div class="grid content-start gap-6">
          <section class=${cardClass()}>
            <div class="flex items-center gap-2">${statusBadge(task.status, task.error)}<span class="text-xs text-muted-foreground">attempt ${task.attempt}</span></div>
            ${task.description ? html`<p class="m-0 mt-3 whitespace-pre-wrap">${task.description}</p>` : html`<p class="m-0 mt-3 text-muted-foreground">No description.</p>`}
            ${task.error ? html`
              <div class="mt-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm">
                <p class="m-0 font-medium text-destructive">This stage failed</p>
                <pre class="m-0 mt-1 whitespace-pre-wrap font-mono text-xs">${task.error}</pre>
                <form action=${retryTask} class="mt-3"><input type="hidden" name="taskId" value=${task.id}><button type="submit" class=${buttonClass({ variant: 'outline', size: 'sm' })}>Retry</button></form>
              </div>` : ''}
          </section>

          ${task.plan ? html`
            <section class=${cardClass()}>
              <h2 class="m-0 text-base font-semibold">Plan</h2>
              <pre class="m-0 mt-2 whitespace-pre-wrap font-sans text-sm">${task.plan}</pre>
            </section>` : ''}

          <section class=${cardClass()}>
            <h2 class="m-0 text-base font-semibold">Activity</h2>
            <ol class="m-0 mt-2 grid list-none gap-1.5 p-0 font-mono text-xs">
              ${events.map((e) => html`
                <li class="flex gap-3 ${e.kind === 'error' ? 'text-destructive' : e.kind === 'status' ? 'text-foreground' : 'text-muted-foreground'}">
                  <span class="shrink-0 tabular-nums">${time(e.createdAt)}</span>
                  <span class="whitespace-pre-wrap">${e.message}</span>
                </li>
              `)}
            </ol>
          </section>
        </div>

        <aside class="grid content-start gap-4">
          <section class=${cardClass()}>
            <h2 class="m-0 text-base font-semibold">Deliverables</h2>
            <dl class="m-0 mt-2 grid gap-2 text-sm">
              <div><dt class="text-muted-foreground">Branch</dt><dd class="m-0 font-mono">${task.branch ?? '…'}</dd></div>
              <div><dt class="text-muted-foreground">Pull request</dt><dd class="m-0">${task.prUrl ? html`<a href=${task.prUrl} target="_blank" rel="noopener">#${task.prNumber}</a>` : '…'}</dd></div>
              <div><dt class="text-muted-foreground">Preview</dt><dd class="m-0">${task.previewUrl ? html`<a href=${task.previewUrl} target="_blank" rel="noopener" class="break-all">${task.previewUrl}</a>` : '…'}</dd></div>
            </dl>
          </section>

          ${task.status === 'ready_for_review' ? html`
            <section class=${cardClass()}>
              <h2 class="m-0 text-base font-semibold">Review</h2>
              ${actionData?.error ? html`<p class="mt-2 text-sm text-destructive">${actionData.error}</p>` : ''}
              <form action=${approveTask} class="mt-3">
                <input type="hidden" name="taskId" value=${task.id}>
                <button type="submit" class=${buttonClass()}>Approve and merge</button>
              </form>
              <form action=${requestChanges} class="mt-4 grid gap-2">
                <input type="hidden" name="taskId" value=${task.id}>
                ${formLabel('Request changes', 'feedback')}
                <textarea id="feedback" name="feedback" rows="3" class=${textareaClass()} placeholder="What should be different?"></textarea>
                ${fieldError(errors.feedback)}
                <button type="submit" class=${buttonClass({ variant: 'outline' })}>Send back to In progress</button>
              </form>
            </section>` : ''}

          ${task.feedback ? html`
            <section class=${cardClass()}>
              <h2 class="m-0 text-base font-semibold">Latest feedback</h2>
              <p class="m-0 mt-2 whitespace-pre-wrap text-sm">${task.feedback}</p>
            </section>` : ''}
        </aside>
      </div>
    </webjs-frame>
  `;
}
