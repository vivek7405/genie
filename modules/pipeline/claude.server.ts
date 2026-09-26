// Server-only: Claude Code inside a task machine, signed in for one process.
//
// The token (CLAUDE_CODE_OAUTH_TOKEN from this server's env) and the GitHub
// credential ride as the env of the ONE buffered exec that runs the launcher,
// the way `pilot claude` forwards them. The launcher installs Claude Code the
// first time and then execs it, so the credential is only ever in that
// process's environment, written to no file in the machine.
import { execLong, shellQuote, writeFile } from './pilots.server.ts';
import { gitEnv } from './git.server.ts';

// The claudeLauncher script from the pilot CLI (apps/pilot/internal/cli/
// claude_cmd.go), ported line by line with its comments, the `pilot:` prefix
// on its messages changed to `genie:`. It contains no credential.
export const CLAUDE_LAUNCHER = `# HOME, before anything below expands it.
#
# The guest agent describes the account a command runs as -- HOME, USER, PATH
# -- but older agents did that only for a NAMED account, and an image with no
# unprivileged \`pilot\` user took a branch that set none of it. An unset HOME does
# not fail, it expands: "$HOME/.npm-global" became "/.npm-global", and the
# marker below went to "undefined/.claude.json", so Claude Code ran its login
# screen on every start. The agent is fixed, but a machine carries the agent it
# was BUILT with, so every machine that exists today still has the old one.
# getent is absent from some busybox builds, so /etc/passwd is read directly as
# well. With no entry at all -- a distroless image, or a bare-number USER --
# "docker run" sets HOME=/ rather than inventing a directory, and so does this:
# /root is right only for uid 0, and an unwritable one is worse than none.
if [ -z "$HOME" ]; then
  HOME=$(getent passwd "$(id -u)" 2>/dev/null | cut -d: -f6)
  [ -n "$HOME" ] || HOME=$(awk -F: -v u="$(id -u)" '$3 == u { print $6; exit }' /etc/passwd 2>/dev/null)
  if [ -z "$HOME" ]; then
    if [ "$(id -u)" = "0" ]; then HOME=/root; else HOME=/; fi
  fi
  export HOME
fi
# The home the passwd entry NAMES need not exist on disk. npm, node and claude
# all write into it, and a missing one fails them one at a time with different
# messages, so it is made once here.
mkdir -p "$HOME" 2>/dev/null || true
export PATH="$HOME/.npm-global/bin:$PATH"
if ! command -v claude >/dev/null 2>&1; then
  echo "genie: installing Claude Code in this machine (once)..." >&2
  if ! command -v npm >/dev/null 2>&1; then
    echo "genie: this machine has no npm; create it from a template that does, such as node" >&2
    exit 127
  fi
  mkdir -p "$HOME/.npm-global" &&
    npm config set prefix "$HOME/.npm-global" >/dev/null 2>&1 &&
    npm install -g @anthropic-ai/claude-code >/dev/null 2>&1 ||
    { echo "genie: could not install Claude Code" >&2; exit 127; }
fi
# Claude Code runs its first-run onboarding, LOGIN SCREEN included, on any
# home directory that has not finished it -- whatever credential is in the
# environment. So a machine signed in by variable still asked for a browser
# login. This marks onboarding done. It is a preference and not a secret, and
# it is merged so nothing else in the file is lost.
node -e '
// os.homedir(), not process.env.HOME, because that is what Claude Code itself
// resolves its config with: node falls back to the passwd entry when HOME is
// unset, so reading it any other way can mark a file Claude Code never opens.
const fs = require("fs"), p = require("os").homedir() + "/.claude.json";
let j = {};
try { j = JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) {}
if (j.hasCompletedOnboarding !== true) {
  j.hasCompletedOnboarding = true;
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
}' 2>/dev/null || true
exec claude "$@"`;

// $0 of the launcher, which is how a session running Claude Code is told
// from any other console on the machine.
const SESSION_MARK = 'genie-claude';

// An argument the guest shell should expand rather than receive verbatim.
export interface RawArg {
  raw: string;
}
export type ClaudeArg = string | RawArg;

// `sh -c '<launcher>' genie-claude <args...>`: the script is $0's program,
// the mark is $0, and every argument reaches `claude` untouched (a RawArg is
// left unquoted so the shell expands it).
export function claudeCommand(args: readonly ClaudeArg[]): string {
  const rest = args.map((a) => (typeof a === 'string' ? shellQuote(a) : a.raw));
  return ['sh', '-c', shellQuote(CLAUDE_LAUNCHER), SESSION_MARK, ...rest].join(' ');
}

export const DEFAULT_PROMPT_PATH = '/home/pilot/.genie/prompt.md';
export const DEFAULT_LOG_PATH = '/home/pilot/.genie/claude.log';

export interface RunClaudeOptions {
  prompt: string;
  cwd: string;
  timeoutMs: number;
  maxTurns: number;
  logPath?: string;
  model?: string;
  // The GitHub token the run acts with (the project's installation token).
  // Left out, the operator's GH_TOKEN is used; null means none at all.
  githubToken?: string | null;
  // Non-secret extras, spread last.
  env?: Record<string, string>;
}

export interface ClaudeRun {
  exitCode: number;
  result: string;
  subtype: string | null;
  costUsd?: number;
  numTurns?: number;
  sessionId?: string;
  isRateLimited: boolean;
  resetsAt: Date | null;
  timedOut: boolean;
  durationMs: number;
}

// The final line of a stream-json run.
interface ResultLine {
  type: 'result';
  subtype?: string;
  is_error?: boolean;
  result?: string;
  total_cost_usd?: number;
  num_turns?: number;
  session_id?: string;
}

// A rate-limit event. The payload key differs between builds; read whichever
// is present.
interface RateLimitPayload {
  status?: string;
  resets_at?: number;
  rate_limit_type?: string;
}
interface RateLimitLine {
  type: 'rate_limit_event';
  rate_limit_info?: RateLimitPayload;
  rate_limits?: RateLimitPayload;
}

const RATE_LIMIT_TEXT = /usage limit reached|hit your limit/i;

function parseLine(line: string): ResultLine | RateLimitLine | null {
  try {
    const parsed: unknown = JSON.parse(line);
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      const typed = parsed as { type: unknown };
      if (typed.type === 'result') return parsed as ResultLine;
      if (typed.type === 'rate_limit_event') return parsed as RateLimitLine;
    }
  } catch {
    // Not JSON: a killed run leaves a partial line.
  }
  return null;
}

// Runs one headless Claude Code session. The prompt goes to a file first (no
// shell quoting of arbitrary text, nothing in the process list); stdout goes
// to logPath as stream-json so #4 can tail it, stderr to logPath + '.err'.
// After exit the result line and the last rate-limit event are read back.
export async function runClaude(machineId: string, opts: RunClaudeOptions): Promise<ClaudeRun> {
  const token = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (!token) throw new Error('CLAUDE_CODE_OAUTH_TOKEN is not set');
  const ghToken = opts.githubToken === undefined ? process.env.GH_TOKEN : opts.githubToken;
  const logPath = opts.logPath ?? DEFAULT_LOG_PATH;

  await writeFile(machineId, DEFAULT_PROMPT_PATH, opts.prompt);

  const cmd =
    claudeCommand([
      '-p',
      { raw: `"$(cat ${DEFAULT_PROMPT_PATH})"` },
      '--output-format',
      'stream-json',
      '--verbose',
      '--max-turns',
      String(opts.maxTurns),
      '--dangerously-skip-permissions',
      ...(opts.model ? ['--model', opts.model] : []),
    ]) + ` > ${shellQuote(logPath)} 2> ${shellQuote(`${logPath}.err`)}`;
  const run = await execLong(machineId, cmd, {
    cwd: opts.cwd,
    timeoutMs: opts.timeoutMs,
    env: { CLAUDE_CODE_OAUTH_TOKEN: token, ...(ghToken ? gitEnv(ghToken) : {}), ...opts.env },
  });

  const tail = await execLong(
    machineId,
    `tail -n 1 -- ${shellQuote(logPath)}; grep -F '"type":"rate_limit_event"' -- ${shellQuote(logPath)} | tail -n 1`,
    { timeoutMs: 30_000 },
  );
  let result: ResultLine | null = null;
  let event: RateLimitLine | null = null;
  for (const line of tail.stdout.split('\n')) {
    const parsed = parseLine(line.trim());
    if (parsed?.type === 'result') result = parsed;
    else if (parsed?.type === 'rate_limit_event') event = parsed;
  }

  let text = result?.result ?? '';
  if (!result) {
    const err = await execLong(machineId, `tail -c 2000 -- ${shellQuote(`${logPath}.err`)}`, { timeoutMs: 30_000 });
    text = err.stdout;
  }
  const payload = event?.rate_limit_info ?? event?.rate_limits;
  const isRateLimited = payload?.status === 'rejected' || (result?.is_error === true && RATE_LIMIT_TEXT.test(text));
  return {
    exitCode: run.exitCode,
    result: text,
    subtype: result?.subtype ?? null,
    ...(result?.total_cost_usd !== undefined ? { costUsd: result.total_cost_usd } : {}),
    ...(result?.num_turns !== undefined ? { numTurns: result.num_turns } : {}),
    ...(result?.session_id !== undefined ? { sessionId: result.session_id } : {}),
    isRateLimited,
    resetsAt: payload?.resets_at ? new Date(payload.resets_at * 1000) : null,
    timedOut: run.timedOut,
    durationMs: run.durationMs,
  };
}
