// Server-only: git inside a task machine. The GitHub token travels only as
// the env of one buffered exec, as GH_TOKEN (for gh) and as a git insteadOf
// rewrite (for clone and push), so nothing on the machine's disk carries it.
// The token is the project's installation token when the stage passes one
// (repoToken in modules/github/app.server.ts), else the operator's GH_TOKEN.
import type { Project } from '#db/schema.server.ts';
import { execLong, shellQuote } from './pilots.server.ts';

// The env that lets git and gh in the machine reach GitHub as the token.
// GIT_CONFIG_COUNT is git's way of taking config from the environment, so no
// file on the machine is written. Exported for #4 (the build stage's
// `gh pr create` runs with the same env) and the tests.
export function gitEnv(token: string): Record<string, string> {
  return {
    GH_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.https://x-access-token:${token}@github.com/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
  };
}

// `undefined` means the caller left the choice here (the operator's env);
// `null` means the stage resolved no token at all.
function githubToken(token: string | null | undefined): string {
  const resolved = token === undefined ? process.env.GH_TOKEN : token;
  if (!resolved) throw new Error('GH_TOKEN is not set. Install the Genie GitHub App on the repository, or set GH_TOKEN.');
  return resolved;
}

export interface CloneOptions {
  dir?: string;
  token?: string | null;
}

export interface PushOptions {
  token?: string | null;
}

export const DEFAULT_APP_DIR = '/home/pilot/app';

// Clones the project's default branch into `dir`. Idempotent: a machine that
// already holds the repo (a retry) is fetched and reset to origin instead of
// failing, so #4's `test -d /home/pilot/app/.git` probe stays valid. Clones
// only; installing dependencies is a stage decision.
export async function cloneRepo(
  machineId: string,
  project: Pick<Project, 'githubRepo'> & Partial<Pick<Project, 'defaultBranch'>>,
  opts: CloneOptions = {},
): Promise<void> {
  const token = githubToken(opts.token);
  const dir = shellQuote(opts.dir ?? DEFAULT_APP_DIR);
  const branch = shellQuote(project.defaultBranch ?? 'main');
  const url = shellQuote(`https://github.com/${project.githubRepo}.git`);
  const cmd =
    `if [ -d ${dir}/.git ]; then git -C ${dir} fetch origin && git -C ${dir} checkout ${branch} && git -C ${dir} reset --hard origin/${branch}; ` +
    `else git clone --branch ${branch} -- ${url} ${dir}; fi`;
  const res = await execLong(machineId, cmd, { env: gitEnv(token), timeoutMs: 600_000 });
  if (res.exitCode !== 0) throw new Error(`git clone failed: ${res.stderr.trim()}`);
}

export async function pushBranch(machineId: string, dir: string, branch: string, opts: PushOptions = {}): Promise<void> {
  const token = githubToken(opts.token);
  const res = await execLong(machineId, `git -C ${shellQuote(dir)} push -u origin ${shellQuote(branch)}`, {
    env: gitEnv(token),
    timeoutMs: 300_000,
  });
  if (res.exitCode !== 0) throw new Error(`git push failed: ${res.stderr.trim()}`);
}
