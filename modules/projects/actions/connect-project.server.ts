'use server';
import type { ActionResult } from '@webjsdev/server';
import { db } from '#db/connection.server.ts';
import { projects } from '#db/schema.server.ts';
import { requireUser, signedOut } from '#modules/auth/session.server.ts';
import { GithubError, describeError } from '#modules/github/client.server.ts';
import { readRepo } from '#modules/github/repos.server.ts';
import { GITHUB_REPO_PATTERN, normalizeRepo, type Project } from '../types.ts';

export interface ConnectProjectInput {
  githubRepo: string;
}

export const validate = (input: unknown) => {
  const raw = input instanceof FormData ? input.get('githubRepo') : (input as ConnectProjectInput | null)?.githubRepo;
  const githubRepo = normalizeRepo(String(raw ?? ''));
  if (!GITHUB_REPO_PATTERN.test(githubRepo)) return { success: false, fieldErrors: { githubRepo: 'Use the owner/name form, for example acme/website.' } };
  return { success: true, data: { githubRepo } satisfies ConnectProjectInput };
};

export async function connectProject(input: ConnectProjectInput): Promise<ActionResult<Project>> {
  if (!(await requireUser())) return signedOut();
  const fail = (githubRepo: string): ActionResult<Project> => ({ success: false, fieldErrors: { githubRepo } });
  let repo;
  try {
    repo = await readRepo(input.githubRepo);
  } catch (err) {
    if (err instanceof GithubError && err.status === 404) return fail(`${input.githubRepo} was not found, or Genie cannot see it.`);
    return fail(`GitHub did not answer: ${describeError(err)}`);
  }
  if (!repo.canPush) return fail(`Genie cannot push to ${repo.fullName}.`);
  if (repo.archived) return fail(`${repo.fullName} is archived.`);
  if (repo.empty) return fail(`${repo.fullName} is empty. Push a first commit, then connect it.`);
  const [row] = await db.insert(projects)
    .values({ githubRepo: repo.fullName, defaultBranch: repo.defaultBranch })
    .onConflictDoUpdate({ target: projects.githubRepo, set: { defaultBranch: repo.defaultBranch } })
    .returning();
  return { success: true, data: row, redirect: `/projects/${row.id}` };
}
