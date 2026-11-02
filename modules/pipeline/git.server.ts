// Server-only: git inside a task machine. The token travels only as the env of
// one buffered exec, as GH_TOKEN (for gh) and a git insteadOf rewrite (for clone
// and push), so nothing on the machine's disk carries it.
import { execLong, shellQuote } from './pilots.server.ts';

export const APP_DIR = '/home/pilot/app';

export function gitEnv(token: string): Record<string, string> {
  return {
    GH_TOKEN: token,
    GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `url.https://x-access-token:${token}@github.com/.insteadOf`,
    GIT_CONFIG_VALUE_0: 'https://github.com/',
  };
}

function token(): string {
  const value = process.env.GH_TOKEN;
  if (!value) throw new Error('GH_TOKEN is not set.');
  return value;
}

// Clones the default branch, or refreshes a clone already there (a retry). A
// refresh only fetches: the task branch may hold unpushed work worth keeping.
export async function cloneRepo(machineId: string, repo: string, branch: string): Promise<void> {
  const dir = shellQuote(APP_DIR);
  const url = shellQuote(`https://github.com/${repo}.git`);
  const cmd =
    `if [ -d ${dir}/.git ]; then git -C ${dir} fetch origin; ` +
    `else git clone --branch ${shellQuote(branch)} -- ${url} ${dir}; fi` +
    ` && git -C ${dir} config user.name genie && git -C ${dir} config user.email genie@users.noreply.github.com`;
  const res = await execLong(machineId, cmd, { env: gitEnv(token()), timeoutMs: 600_000 });
  if (res.exitCode !== 0) throw new Error(`git clone failed: ${res.stderr.trim()}`);
}

export async function pushBranch(machineId: string, branch: string): Promise<void> {
  const res = await execLong(machineId, `git -C ${shellQuote(APP_DIR)} push -u origin ${shellQuote(branch)}`, {
    env: gitEnv(token()),
    timeoutMs: 300_000,
  });
  if (res.exitCode !== 0) throw new Error(`git push failed: ${res.stderr.trim()}`);
}
