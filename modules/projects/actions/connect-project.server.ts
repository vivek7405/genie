'use server';
// Form-bound: the connect page posts here with JS off or on. `validate` turns
// the FormData into the typed input. With the GitHub App configured the
// project belongs to the signed-in person and to the installation the
// repository was picked from, and the pick is checked against that
// installation's repositories (read with the person's own token) so nobody
// can point Genie at a repository they were not granted. A board is resolved
// or created against GitHub right away; when that fails the project still
// lands and the board page shows the stored error until a sync tick resolves
// it.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { projects } from '#db/schema.server.ts';
import type { ActionResult } from '@webjsdev/server';
import { currentUser } from '#modules/auth/queries/current-user.server.ts';
import { signedOut } from '#modules/auth/session.server.ts';
import { describeError } from '#modules/github/client.server.ts';
import { createBoard, githubAppConfigured, installationRepos } from '#modules/github/app.server.ts';
import { resolveBoard } from '#modules/github/projects-v2.server.ts';
import { GITHUB_REPO_PATTERN, type ConnectProjectInput, type Project } from '../types.ts';

export const validate = (input: unknown) => {
  const fd = input instanceof FormData ? input : new FormData();
  const fieldErrors: Record<string, string> = {};
  const githubRepo = String(fd.get('githubRepo') ?? '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
  const name = String(fd.get('name') ?? '').trim() || githubRepo.split('/')[1] || '';
  const rawNumber = String(fd.get('githubProjectNumber') ?? '').trim();
  const createBoard = rawNumber === 'new';
  const githubProjectNumber = rawNumber && !createBoard ? Number(rawNumber) : null;
  const rawInstallation = String(fd.get('installationId') ?? '').trim();
  const installationId = rawInstallation ? Number(rawInstallation) : null;
  if (!GITHUB_REPO_PATTERN.test(githubRepo)) fieldErrors.githubRepo = 'Use the owner/name form, for example vivek7405/genie.';
  if (githubProjectNumber !== null && (!Number.isInteger(githubProjectNumber) || githubProjectNumber < 1)) {
    fieldErrors.githubProjectNumber = 'The project number is the integer in the board URL.';
  }
  if (installationId !== null && (!Number.isInteger(installationId) || installationId < 1)) fieldErrors.githubRepo = 'Pick a repository from the list.';
  if (Object.keys(fieldErrors).length) {
    return { success: false, fieldErrors, values: { name, githubRepo, githubProjectNumber: rawNumber, installationId: rawInstallation } };
  }
  return { success: true, data: { name, githubRepo, githubProjectNumber, installationId, createBoard } satisfies ConnectProjectInput };
};

export async function connectProject(input: ConnectProjectInput): Promise<ActionResult<Project>> {
  const user = await currentUser();
  // Every project has an owner, whatever the GitHub configuration: the form
  // path is behind the dashboard gate, and this closes the RPC path too.
  if (!user) return signedOut();
  const withApp = githubAppConfigured();
  if (withApp && !user) return { success: false, error: 'Sign in with GitHub to connect a repository.', status: 401 };

  let githubRepo = input.githubRepo;
  let defaultBranch = 'main';
  let installationId: number | null = null;
  if (withApp && user) {
    if (input.installationId == null) return { success: false, fieldErrors: { githubRepo: 'Pick a repository from one of your installations.' } };
    let granted;
    try {
      granted = await installationRepos(input.installationId, user);
    } catch (err) {
      return { success: false, error: `GitHub did not answer: ${describeError(err)}`, status: 502 };
    }
    const match = granted.find((r) => r.fullName.toLowerCase() === input.githubRepo.toLowerCase());
    if (!match) return { success: false, fieldErrors: { githubRepo: `${input.githubRepo} is not in that installation. Grant it to Genie on GitHub, then pick it again.` } };
    githubRepo = match.fullName;
    defaultBranch = match.defaultBranch || 'main';
    installationId = input.installationId;
  }

  const existing = await db.query.projects.findFirst({ where: { userId: user.id, githubRepo } });
  if (existing) return { success: true, data: existing, redirect: `/dashboard/projects/${existing.id}` };
  const create = input.createBoard && Boolean(user);
  const [row] = await db.insert(projects).values({
    name: input.name, githubRepo, defaultBranch, installationId, userId: user.id, githubProjectNumber: create ? null : input.githubProjectNumber,
  }).returning();
  let project = row;
  try {
    if (create) project = await createBoard(user!, row, row.name);
    else if (row.githubProjectNumber) project = await resolveBoard(row);
  } catch (err) {
    [project] = await db.update(projects).set({ syncError: describeError(err) }).where(eq(projects.id, row.id)).returning();
  }
  return { success: true, data: project, redirect: `/dashboard/projects/${project.id}` };
}
