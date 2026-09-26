import { html } from '@webjsdev/core';
import { buttonClass } from '#components/ui/button.ts';
import { cardClass } from '#components/ui/card.ts';
import { inputClass } from '#components/ui/input.ts';
import { cn } from '#lib/utils/cn.ts';
import { pageHeading, lede, fieldError, formLabel } from '#lib/utils/ui.ts';
import { connectProject } from '#modules/projects/actions/connect-project.server.ts';
import { listProjects } from '#modules/projects/queries/list-projects.server.ts';

export const metadata = { title: 'Projects' };

interface HomeProps {
  actionData?: { fieldErrors?: Record<string, string>; values?: Record<string, string> };
}

export default async function Home({ actionData }: HomeProps) {
  const projects = await listProjects();
  const errors = actionData?.fieldErrors ?? {};
  const values = actionData?.values ?? {};
  return html`
    ${pageHeading('Projects')}
    ${lede('Connect a GitHub repository. Tasks you create for it are planned, built on a branch and shipped for review by genie.')}
    <div class="grid gap-8 lg:grid-cols-[1fr_380px]">
      <section aria-label="Connected projects">
        ${projects.length === 0
          ? html`<p class="rounded-xl border border-dashed border-border p-8 text-center text-muted-foreground">No projects yet. Connect one on the right.</p>`
          : html`
            <ul class="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
              ${projects.map((p) => html`
                <li>
                  <a href="/projects/${p.id}" class=${cn(cardClass({ size: 'sm' }), 'block no-underline text-card-foreground transition-colors hover:border-ring')}>
                    <span class="font-semibold">${p.name}</span>
                    <span class="block text-sm text-muted-foreground">${p.githubRepo}${p.githubProjectNumber ? html` · board #${p.githubProjectNumber}` : ''}</span>
                  </a>
                </li>
              `)}
            </ul>
          `}
      </section>
      <section class=${cardClass()} aria-label="Connect a repository">
        <h2 class="m-0 text-base font-semibold">Connect a repo</h2>
        <form action=${connectProject} class="mt-3 grid gap-3">
          <div>
            ${formLabel('GitHub repository', 'githubRepo')}
            <input id="githubRepo" name="githubRepo" class=${inputClass()} placeholder="owner/name" value=${values.githubRepo ?? ''} required>
            ${fieldError(errors.githubRepo)}
          </div>
          <div>
            ${formLabel('Project board number (optional)', 'githubProjectNumber')}
            <input id="githubProjectNumber" name="githubProjectNumber" class=${inputClass()} inputmode="numeric" placeholder="11" value=${values.githubProjectNumber ?? ''}>
            ${fieldError(errors.githubProjectNumber)}
          </div>
          <div>
            ${formLabel('Display name (optional)', 'name')}
            <input id="name" name="name" class=${inputClass()} placeholder="Defaults to the repo name" value=${values.name ?? ''}>
          </div>
          <button type="submit" class=${buttonClass()}>Connect</button>
        </form>
      </section>
    </div>
  `;
}
