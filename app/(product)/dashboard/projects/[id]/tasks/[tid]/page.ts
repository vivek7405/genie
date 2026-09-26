import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { textareaClass } from '#components/ui/textarea.ts';
import { backLink, errorAlert, facts, field, pageHeader, panel, sectionHeading } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';
import { getProject } from '#modules/projects/queries/get-project.server.ts';
import { approveTask } from '#modules/tasks/actions/approve-task.server.ts';
import { requestChanges } from '#modules/tasks/actions/request-changes.server.ts';
import { retryTask } from '#modules/tasks/actions/retry-task.server.ts';
import { getTask } from '#modules/tasks/queries/get-task.server.ts';
import { listEvents } from '#modules/tasks/queries/list-events.server.ts';
import { COLUMNS, labelOf } from '#modules/tasks/utils/state-machine.ts';
import { statusBadge } from '#modules/tasks/utils/ui/status-badge.ts';
import { clock, isDeferred } from '#modules/tasks/utils/ui/clock.ts';
import '#modules/tasks/components/live-refresh.ts';

interface CardProps extends PageProps<'/dashboard/projects/[id]/tasks/[tid]'> {
  actionData?: { fieldErrors?: Record<string, string>; error?: string };
}

export async function generateMetadata({ params }: PageProps<'/dashboard/projects/[id]/tasks/[tid]'>) {
  const task = await getTask(params.tid);
  return { title: task ? task.title : 'Task' };
}

const time = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const ext = (href: string, label: unknown) => html`<a href=${href} target="_blank" rel="noopener" class="break-all">${label}</a>`;
const pending = html`<span class="text-muted-foreground">not yet</span>`;

export default async function TaskCard({ params, actionData }: CardProps) {
  const [project, task] = await Promise.all([getProject(params.id), getTask(params.tid)]);
  if (!project || !task || task.projectId !== project.id) notFound();
  const events = await listEvents(task.id);
  const errors = actionData?.fieldErrors ?? {};
  const stepIndex = COLUMNS.findIndex((c) => c.status === task.status);
  return html`
    ${pageHeader({
      above: backLink(`/dashboard/projects/${project.id}`, project.name),
      title: task.title,
      lede: html`<span class="inline-flex flex-wrap items-center gap-2">${statusBadge(task.status, task.error, task.deferredUntil)}<span class="font-mono text-label uppercase tracking-[0.12em] text-muted-foreground">attempt ${task.attempt} · created ${task.createdAt.toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}</span></span>${!task.error && isDeferred(task) ? html`<span class="mt-1 block text-meta text-muted-foreground">${task.deferReason ?? 'Waiting'}, retrying at ${clock(task.deferredUntil!)}.</span>` : ''}`,
      actions: html`<live-refresh project-id=${project.id} frame="task"></live-refresh>`,
    })}

    <webjs-frame id="task" class="block">
      <ol class="m-0 mb-8 flex list-none flex-wrap gap-1.5 p-0" aria-label="Pipeline">
        ${COLUMNS.map((c, i) => html`
          <li class=${cn('rounded-sm border px-2.5 py-1 font-mono text-label uppercase tracking-[0.12em]',
            i < stepIndex ? 'border-border text-muted-foreground' : i === stepIndex ? 'border-foreground bg-foreground text-background' : 'border-dashed border-border text-muted-foreground/70')}>${c.label}</li>
        `)}
      </ol>

      ${actionData?.error ? errorAlert(actionData.error) : ''}

      <div class="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div class="grid content-start gap-8">
          ${task.error ? html`
            <section class="rounded-md border border-destructive/40 bg-destructive/5 p-5">
              <h2 class="m-0 text-heading font-semibold text-destructive">Attempt ${task.attempt} failed in ${labelOf(task.status)}</h2>
              <pre class="m-0 mt-2 whitespace-pre-wrap font-mono text-meta">${task.error}</pre>
              <p class="m-0 mt-2 text-meta text-muted-foreground">Retry re-runs this stage on the task's machine${task.feedback ? ', applying the same feedback' : ''}.</p>
              <form action=${retryTask} class="mt-4"><input type="hidden" name="taskId" value=${task.id}><button type="submit" class=${buttonClass({ variant: 'outline', size: 'sm' })}>Retry ${labelOf(task.status)}</button></form>
            </section>` : ''}

          <section>
            ${sectionHeading('Brief', 'What the reviewer asked for, in their words.')}
            ${panel(task.description ? html`<p class="m-0 whitespace-pre-wrap text-body">${task.description}</p>` : html`<p class="m-0 text-body text-muted-foreground">No brief beyond the title.</p>`)}
          </section>

          ${task.plan ? html`
            <section>
              ${sectionHeading('Plan', 'Written by the agent from the brief and the repository, before any code.')}
              ${panel(html`<pre class="m-0 whitespace-pre-wrap font-sans text-body">${task.plan}</pre>`)}
            </section>` : ''}

          <section>
            ${sectionHeading('Activity', 'Every step Genie took on this card, newest last.')}
            ${panel(events.length === 0 ? html`<p class="m-0 text-meta text-muted-foreground">Nothing yet. The worker writes here as it goes.</p>` : html`
              <ol class="m-0 grid list-none gap-1.5 p-0 font-mono text-meta">
                ${events.map((e) => html`
                  <li class=${cn('flex gap-3', e.kind === 'error' ? 'text-destructive' : e.kind === 'status' ? 'text-foreground' : 'text-muted-foreground')}>
                    <span class="shrink-0 tabular-nums text-muted-foreground">${time(e.createdAt)}</span>
                    <span class="min-w-0 whitespace-pre-wrap break-words">${e.message}</span>
                  </li>
                `)}
              </ol>`, 'p-4')}
          </section>
        </div>

        <aside class="grid content-start gap-8">
          ${task.status === 'done' ? html`
            <section>
              ${sectionHeading('Merged, production deploying', 'Pilots deploys the default branch on its own. Genie does not wait for it.')}
              ${panel(html`<p class="m-0 text-body">
                ${task.prNumber != null ? html`PR ${ext(task.prUrl ?? `https://github.com/${project.githubRepo}/pull/${task.prNumber}`, `#${task.prNumber}`)} was squash-merged into <code>${project.defaultBranch}</code>.` : 'Approved without a pull request.'}
                ${project.productionUrl
                  ? html` Pilots deploys <code>${project.defaultBranch}</code> to ${ext(project.productionUrl, project.productionUrl)}.`
                  : html` No Pilots service tracks this repository, so nothing deploys. Connect the repo to Pilots with <code>pilot repo connect ${project.githubRepo}</code>.`}
              </p>`)}
            </section>` : ''}

          <section>
            ${sectionHeading('Deliverables', 'What Genie hands back when the card is ready.')}
            ${panel(facts([
              { label: 'Issue', value: task.githubIssueNumber != null ? ext(`https://github.com/${project.githubRepo}/issues/${task.githubIssueNumber}`, `#${task.githubIssueNumber}`) : pending },
              { label: 'Branch', value: task.branch ? html`<span class="font-mono text-meta">${task.branch}</span>` : pending },
              { label: 'Pull request', value: task.prUrl ? ext(task.prUrl, `#${task.prNumber}`) : pending },
              { label: 'Preview', value: task.previewUrl ? ext(task.previewUrl, task.previewUrl.replace(/^https?:\/\//, '')) : task.status === 'done' ? html`<span class="text-muted-foreground">removed on merge</span>` : pending },
              { label: 'Sandbox', value: task.machineName ? html`<span class="font-mono text-meta">${task.machineName}</span>` : pending },
            ]))}
          </section>

          ${task.status === 'ready_for_review' ? html`
            <section>
              ${sectionHeading('Review', 'Approve merges the pull request. Changes send it back with your note.')}
              ${task.claimedAt ? panel(html`<p class="m-0 text-body text-muted-foreground">Merging${task.prNumber != null ? html` PR #${task.prNumber}` : ''}… Reload in a moment.</p>`) : panel(html`
                <form action=${approveTask}>
                  <input type="hidden" name="taskId" value=${task.id}>
                  <button type="submit" class=${cn(buttonClass(), 'w-full')}>Approve and merge</button>
                </form>
                <form action=${requestChanges} class="mt-5 grid gap-3">
                  <input type="hidden" name="taskId" value=${task.id}>
                  ${field({
                    id: 'feedback',
                    label: 'Request changes',
                    error: errors.feedback,
                    control: html`<textarea id="feedback" name="feedback" rows="4" placeholder="What should be different?" class=${textareaClass()}></textarea>`,
                  })}
                  <button type="submit" class=${cn(buttonClass({ variant: 'outline' }), 'w-full')}>Send back to In progress</button>
                </form>`)}
            </section>` : ''}

          ${task.feedback ? html`
            <section>
              ${sectionHeading('Feedback being applied', task.status === 'in_progress' ? 'Genie is revising the same branch with this note. The preview is rebuilt when it pushes.' : 'The note the next revise will apply.')}
              ${panel(html`<p class="m-0 whitespace-pre-wrap text-body">${task.feedback}</p>`)}
            </section>` : ''}

        </aside>
      </div>
    </webjs-frame>
  `;
}
