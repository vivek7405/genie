import { html, notFound } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { inputClass } from '#components/ui/input.ts';
import { textareaClass } from '#components/ui/textarea.ts';
import { backLink, cardBody, field, footnote, pageHeader } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';
import { getProject } from '#modules/projects/queries/get-project.server.ts';
import { createTask } from '#modules/tasks/actions/create-task.server.ts';

interface NewTaskProps extends PageProps<'/dashboard/projects/[id]/tasks/new'> {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
}

export const metadata = { title: 'New task' };

export default async function NewTask({ params, actionData }: NewTaskProps) {
  const project = await getProject(params.id);
  if (!project) notFound();
  const errors = actionData?.fieldErrors ?? {};
  const values = actionData?.values ?? {};
  return html`
    ${pageHeader({
      above: backLink(`/dashboard/projects/${project.id}`, project.name),
      title: 'New task',
      lede: 'Describe the change the way you would brief a colleague. Genie plans it, builds it on a branch and opens the pull request.',
    })}
    <form action=${createTask} class=${cn(cardClass(), cardBody(), 'grid max-w-2xl gap-5')}>
      <input type="hidden" name="projectId" value=${project.id}>
      ${field({
        id: 'title',
        label: 'Title',
        error: errors.title,
        control: html`<input id="title" name="title" required placeholder="Add an /about page with the team" value=${values.title ?? ''} class=${inputClass()}>`,
      })}
      ${field({
        id: 'description',
        label: 'Brief',
        hint: 'Acceptance criteria, links, constraints. The agent reads this and the repository.',
        control: html`<textarea id="description" name="description" rows="6" placeholder="The page lists the three founders with a photo each, is linked from the header, and passes the existing tests." class=${textareaClass()}>${values.description ?? ''}</textarea>`,
      })}
      <div class="flex items-center gap-3">
        <button type="submit" class=${buttonClass()}>Add to Todo</button>
        <a href="/dashboard/projects/${project.id}" class=${cn(buttonClass({ variant: 'ghost' }), 'no-underline')}>Cancel</a>
      </div>
    </form>
    ${footnote('The card lands in Todo and the worker claims it on its next tick.')}
  `;
}
