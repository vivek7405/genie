import { html } from '@webjsdev/core';
import type { PageProps, TemplateResult } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { inputClass } from '#components/ui/input.ts';
import { nativeSelectClass, nativeSelectIconClass, nativeSelectWrapperClass } from '#components/ui/native-select.ts';
import { backLink, cardBody, errorAlert, field, footnote, pageHeader } from '#lib/utils/ui.ts';
import { cn } from '#lib/utils/cn.ts';
import { connectProject } from '#modules/projects/actions/connect-project.server.ts';
import { connectOptions, type ConnectOptions } from '#modules/projects/queries/connect-options.server.ts';

export const metadata = { title: 'Connect a repo' };

interface ActionData { error?: string; fieldErrors?: Record<string, string>; values?: Record<string, string> }

const formClass = () => cn(cardClass(), cardBody(), 'grid max-w-xl gap-5');

const chevron = () => html`<svg class=${nativeSelectIconClass()} aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

function select(attrs: { id: string; name: string; required?: boolean }, options: TemplateResult): TemplateResult {
  return html`
    <div class=${cn(nativeSelectWrapperClass(), 'w-full')}>
      <select id=${attrs.id} name=${attrs.name} ?required=${attrs.required ?? false} class=${nativeSelectClass()}>${options}</select>
      ${chevron()}
    </div>
  `;
}

const nameField = (values: Record<string, string>) => field({
  id: 'name',
  label: 'Display name',
  hint: 'Defaults to the repository name.',
  control: html`<input id="name" name="name" placeholder="Shop" value=${values.name ?? ''} class=${inputClass()}>`,
});

// No GitHub App on this server: the operator's own token serves every
// repository, so the form takes owner/name and a board number.
function operatorForm(errors: Record<string, string>, values: Record<string, string>): TemplateResult {
  return html`
    <form action=${connectProject} class=${formClass()}>
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
        hint: 'The number in the board URL. Optional: without it, tasks live only in Genie.',
        error: errors.githubProjectNumber,
        control: html`<input id="githubProjectNumber" name="githubProjectNumber" inputmode="numeric" placeholder="11" value=${values.githubProjectNumber ?? ''} class=${cn(inputClass(), 'max-w-40 font-mono')}>`,
      })}
      ${nameField(values)}
      <div><button type="submit" class=${buttonClass()}>Connect</button></div>
    </form>
  `;
}

function notice(content: unknown, action?: unknown): TemplateResult {
  return html`
    <div class=${cn(cardClass(), cardBody(), 'grid max-w-xl gap-3')}>
      <p class="m-0 text-body">${content}</p>
      ${action ? html`<div>${action}</div>` : ''}
    </div>
  `;
}

// Step one, a plain GET: pick the repository. Step two, bound to the connect
// action once ?repo= names one Genie was granted: the board and the name.
function picker(o: Extract<ConnectOptions, { mode: 'pick' }>, errors: Record<string, string>, values: Record<string, string>): TemplateResult {
  const repoForm = html`
    <form method="get" action="/dashboard/projects/new" class=${formClass()}>
      ${field({
        id: 'repo',
        label: 'Repository',
        hint: html`The repositories Genie is installed on. Missing one? <a href=${o.installUrl} rel="noopener">Grant it on GitHub</a>.`,
        error: o.unknownRepo ? `${o.unknownRepo} is not one Genie was granted.` : errors.githubRepo,
        // A text input over a datalist rather than a select: an account with
        // hundreds of repositories needs typing to filter, and a datalist
        // filters natively with no client code. The server still refuses a
        // name Genie was not granted (o.unknownRepo), so free text is safe.
        control: html`
          <input id="repo" name="repo" list="repo-list" required autocomplete="off" spellcheck="false"
            placeholder="Type to search, for example owner/name"
            value=${o.repo?.fullName ?? values.repo ?? ''} class=${cn(inputClass(), 'w-full')} />
          <datalist id="repo-list">
            ${o.installations.flatMap((i) => i.repos.map((r) => html`<option value=${r.fullName}>${i.account}${r.private ? ' (private)' : ''}</option>`))}
          </datalist>
        `,
      })}
      <div><button type="submit" class=${buttonClass({ variant: o.repo ? 'outline' : 'default' })}>${o.repo ? 'Change repository' : 'Choose'}</button></div>
    </form>
  `;
  if (!o.repo) return repoForm;
  const repo = o.repo;
  const linked = (b: (typeof o.boards)[number]) => b.repos.some((r) => r.toLowerCase() === repo.fullName.toLowerCase());
  const firstLinked = o.boards.find(linked);
  const chosen = values.githubProjectNumber ?? (firstLinked ? String(firstLinked.number) : 'new');
  return html`
    ${repoForm}
    <form action=${connectProject} class=${cn(formClass(), 'mt-6')}>
      <input type="hidden" name="githubRepo" value=${repo.fullName}>
      <input type="hidden" name="installationId" value=${String(repo.installationId)}>
      ${field({
        id: 'githubProjectNumber',
        label: 'Project board',
        hint: `Boards under ${repo.owner}, the ones linked to ${repo.fullName} first. Genie adds Plan and Review columns to the one you pick.`,
        error: errors.githubProjectNumber,
        control: select({ id: 'githubProjectNumber', name: 'githubProjectNumber' }, html`
          ${o.boards.map((b) => html`<option value=${String(b.number)} ?selected=${chosen === String(b.number)}>${b.title} (#${b.number}${linked(b) ? ', linked' : ''})</option>`)}
          <option value="new" ?selected=${chosen === 'new'}>Create a board for this repo</option>
          <option value="" ?selected=${chosen === ''}>No board: tasks live only in Genie</option>
        `),
      })}
      ${nameField({ ...values, name: values.name ?? repo.fullName.split('/')[1] })}
      <div><button type="submit" class=${buttonClass()}>Connect ${repo.fullName}</button></div>
    </form>
  `;
}

export default async function NewProject({ searchParams, actionData }: PageProps) {
  const data = (actionData as ActionData | undefined) ?? {};
  const errors = data.fieldErrors ?? {};
  const values = data.values ?? {};
  const params = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const options = await connectOptions({ repo: one(params.repo), installation_id: one(params.installation_id) });

  let body: TemplateResult;
  switch (options.mode) {
    case 'operator':
      body = operatorForm(errors, values);
      break;
    case 'signed-out':
      body = notice('Sign in with GitHub to connect a repository.', html`<a href="/login" class=${cn(buttonClass(), 'no-underline')}>Sign in</a>`);
      break;
    case 'install':
      body = notice(
        'Genie is not installed on any of your GitHub accounts yet. Install it on the account or organisation that owns the repository, choosing the repositories Genie may work on. GitHub brings you back here.',
        html`<a href=${options.installUrl} rel="noopener" class=${cn(buttonClass(), 'no-underline')}>Install Genie on GitHub</a>`,
      );
      break;
    case 'error':
      body = notice(html`GitHub did not answer: ${options.message}`, html`<a href="/dashboard/projects/new" class=${cn(buttonClass({ variant: 'outline' }), 'no-underline')}>Try again</a>`);
      break;
    default:
      body = html`
        ${options.justInstalled ? html`<p class="m-0 mb-4 max-w-xl text-body text-muted-foreground">Genie is installed on <strong>${options.justInstalled}</strong>. Pick a repository below.</p>` : ''}
        ${picker(options, errors, values)}
      `;
  }

  return html`
    ${pageHeader({
      above: backLink('/dashboard', 'Projects'),
      title: 'Connect a repository',
      lede: 'Point Genie at a GitHub repository. Tasks you create for it are planned, built on a branch and shipped as a pull request with a preview.',
    })}
    ${data.error ? errorAlert(data.error) : ''}
    ${body}
    ${footnote('Only board cards carrying the genie label are picked up, so human-only work on the same board stays untouched.')}
  `;
}
