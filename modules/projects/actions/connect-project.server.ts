'use server';
// Form-bound: the "Connect a repo" form on the home page posts here with JS
// off or on. `validate` turns the FormData into the typed input.
import { db } from '#db/connection.server.ts';
import { projects } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { GITHUB_REPO_PATTERN, type ConnectProjectInput, type Project } from '../types.ts';

export const validate = (input: unknown) => {
  const fd = input instanceof FormData ? input : new FormData();
  const fieldErrors: Record<string, string> = {};
  const githubRepo = String(fd.get('githubRepo') ?? '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const name = String(fd.get('name') ?? '').trim() || githubRepo.split('/')[1] || '';
  const rawNumber = String(fd.get('githubProjectNumber') ?? '').trim();
  const githubProjectNumber = rawNumber ? Number(rawNumber) : null;
  if (!GITHUB_REPO_PATTERN.test(githubRepo)) fieldErrors.githubRepo = 'Use the owner/name form, for example vivek7405/genie.';
  if (githubProjectNumber !== null && (!Number.isInteger(githubProjectNumber) || githubProjectNumber < 1)) {
    fieldErrors.githubProjectNumber = 'The project number is the integer in the board URL.';
  }
  if (Object.keys(fieldErrors).length) {
    return { success: false, fieldErrors, values: { name, githubRepo, githubProjectNumber: rawNumber } };
  }
  return { success: true, data: { name, githubRepo, githubProjectNumber } satisfies ConnectProjectInput };
};

export async function connectProject(input: ConnectProjectInput): Promise<ActionResult<Project>> {
  const existing = await db.query.projects.findFirst({ where: { githubRepo: input.githubRepo } });
  if (existing) return { success: true, data: existing, redirect: `/dashboard/projects/${existing.id}` };
  const [row] = await db.insert(projects).values(input).returning();
  return { success: true, data: row, redirect: `/dashboard/projects/${row.id}` };
}
