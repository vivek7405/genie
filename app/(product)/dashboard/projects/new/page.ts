import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { inputClass } from '#components/ui/input.ts';
import { backLink, cardBody, field, footnote, pageHeader } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';
import { connectProject } from '#modules/projects/actions/connect-project.server.ts';

export const metadata = { title: 'Connect a repo' };

interface NewProjectProps {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
}

// One form, bound to the connect action: works with scripting off, and with
// it the client router applies the 303 or the 422 re-render in place.
export default function NewProject({ actionData }: NewProjectProps) {
  const errors = actionData?.fieldErrors ?? {};
  const values = actionData?.values ?? {};
  return html`
    ${pageHeader({
      above: backLink('/', 'Projects'),
      title: 'Connect a repository',
      lede: 'Point genie at a GitHub repository. Tasks you create for it are planned, built on a branch and shipped as a pull request with a preview.',
    })}
    <form action=${connectProject} class=${cn(cardClass(), cardBody(), 'grid max-w-xl gap-5')}>
      ${field({
        id: 'githubRepo',
        label: 'Repository',
        hint: 'owner/name on GitHub, or the full URL',
        error: errors.githubRepo,
        control: html`<input id="githubRepo" name="githubRepo" required placeholder="acme/shop" value=${values.githubRepo ?? ''} class=${cn(inputClass(), 'font-mono')}>`,
      })}
      ${field({
        id: 'githubProjectNumber',
        label: 'Project board',
        hint: 'The number in the board URL. Optional: without it, tasks live only in genie.',
        error: errors.githubProjectNumber,
        control: html`<input id="githubProjectNumber" name="githubProjectNumber" inputmode="numeric" placeholder="11" value=${values.githubProjectNumber ?? ''} class=${cn(inputClass(), 'max-w-40 font-mono')}>`,
      })}
      ${field({
        id: 'name',
        label: 'Display name',
        hint: 'Defaults to the repository name.',
        control: html`<input id="name" name="name" placeholder="Shop" value=${values.name ?? ''} class=${inputClass()}>`,
      })}
      <div><button type="submit" class=${buttonClass()}>Connect</button></div>
    </form>
    ${footnote('Only board cards carrying the genie label are picked up, so human-only work on the same board stays untouched.')}
  `;
}
