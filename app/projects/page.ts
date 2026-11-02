import { html } from '@webjsdev/core';
import type { PageProps } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { inputClass } from '#components/ui/input.ts';
import { cn } from '#lib/utils/cn.ts';
import { formFailure } from '#lib/utils/form.ts';
import { connectProject } from '#modules/projects/actions/connect-project.server.ts';
import { listProjects } from '#modules/projects/queries/list-projects.server.ts';
import { repoSuggestions } from '#modules/projects/queries/repo-suggestions.server.ts';

export const metadata = { title: 'Projects' };

export default async function Projects({ actionData }: PageProps) {
  const [summaries, suggestions] = await Promise.all([listProjects(), repoSuggestions()]);
  const connected = new Set(summaries.map((s) => s.project.githubRepo));
  const failure = formFailure(actionData);
  const error = failure.fieldErrors?.githubRepo ?? failure.error;
  return html`
    <div class="mx-auto max-w-4xl px-4 py-12 sm:px-6">
      <h1 class="m-0 text-h1 font-bold" style="font-family: var(--font-display)">${summaries.length ? 'Your repositories' : 'Connect a repository'}</h1>
      <p class="m-0 mt-2 text-muted-foreground">Pick a repo. Genie opens pull requests against it, and you stay in charge of what merges.</p>

      <form action=${connectProject} class="mt-6 rounded-xl border border-border bg-card p-4 shadow-xs">
        <label for="githubRepo" class="mb-2 block text-sm font-medium">GitHub repository</label>
        <div class="flex flex-col gap-2 sm:flex-row">
          <input id="githubRepo" name="githubRepo" list="repo-suggestions" required autocomplete="off" spellcheck="false" placeholder="owner/name"
            class=${cn(inputClass(), 'flex-1 font-mono')} aria-invalid=${error ? 'true' : 'false'} aria-describedby="repo-error">
          <datalist id="repo-suggestions">
            ${suggestions.filter((name) => !connected.has(name)).map((name) => html`<option value=${name}></option>`)}
          </datalist>
          <button type="submit" class=${buttonClass()}>Connect</button>
        </div>
        <p id="repo-error" class="m-0 mt-2 min-h-5 text-sm text-destructive">${error ?? ''}</p>
      </form>

      ${summaries.length ? html`
        <ul class="m-0 mt-8 grid list-none gap-3 p-0 sm:grid-cols-2">
          ${summaries.map(({ project, counts }) => html`
            <li>
              <a href="/projects/${project.id}" class="block rounded-xl border border-border bg-card p-4 text-card-foreground no-underline shadow-xs transition-colors hover:border-border-strong">
                <span class="block truncate font-mono text-sm font-medium">${project.githubRepo}</span>
                <span class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>${counts.backlog} queued</span>
                  <span class=${counts.in_progress ? 'text-primary' : ''}>${counts.in_progress} in progress</span>
                  <span>${counts.review} in review</span>
                  <span>${counts.done} done</span>
                </span>
              </a>
            </li>`)}
        </ul>` : ''}
    </div>
  `;
}
