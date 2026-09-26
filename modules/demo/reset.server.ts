// Server-only (no 'use server'): empties a project's tasks so the demo can be
// rerun, and optionally closes the genie-labeled PRs and issues it left on
// GitHub. The project row stays so the board URL survives. Deleting rows
// needs no worker pause: the worker only claims rows it can still read, and a
// task deleted mid-run fails its transition update harmlessly. Leftover
// Pilots machines are the cleanup script's job, not this one's.
import { eq, inArray } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { db } from '#db/connection.server.ts';
import { tasks, taskEvents } from '#db/schema.server.ts';

export const DEMO_REPO = 'vivek7405/genie-demo';

export interface ResetOptions {
  /** owner/name, default vivek7405/genie-demo */
  repo?: string;
  /** also close open genie-labeled PRs and issues on the repo */
  github?: boolean;
  /** report only */
  dryRun?: boolean;
  /** gh runner, injectable for tests; resolves with stdout */
  exec?: (cmd: string, args: string[]) => Promise<string>;
}

export interface ResetReport {
  repo: string;
  projectId: string | null;
  tasks: number;
  events: number;
  issuesClosed: number;
  prsClosed: number;
}

const run = promisify(execFile);
async function shell(cmd: string, args: string[]): Promise<string> {
  const { stdout } = await run(cmd, args, { maxBuffer: 4 * 1024 * 1024 });
  return stdout;
}

function numbersOf(json: string): number[] {
  const parsed: unknown = JSON.parse(json || '[]');
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((item: unknown) => (item && typeof item === 'object' && 'number' in item ? Number((item as { number: unknown }).number) : NaN))
    .filter((n) => Number.isInteger(n));
}

export async function resetDemo(options: ResetOptions = {}): Promise<ResetReport> {
  const repo = options.repo ?? DEMO_REPO;
  const exec = options.exec ?? shell;
  const report: ResetReport = { repo, projectId: null, tasks: 0, events: 0, issuesClosed: 0, prsClosed: 0 };

  const project = await db.query.projects.findFirst({ where: { githubRepo: repo } });
  if (project) {
    report.projectId = project.id;
    const rows = await db.query.tasks.findMany({ where: { projectId: project.id }, columns: { id: true } });
    const ids = rows.map((r) => r.id);
    report.tasks = ids.length;
    if (ids.length > 0) {
      const events = await db.query.taskEvents.findMany({ where: { taskId: { in: ids } }, columns: { id: true } });
      report.events = events.length;
      if (!options.dryRun) {
        // Events first: their foreign key points at tasks.
        await db.delete(taskEvents).where(inArray(taskEvents.taskId, ids));
        await db.delete(tasks).where(eq(tasks.projectId, project.id));
      }
    }
  }

  if (options.github) {
    const prs = numbersOf(await exec('gh', ['pr', 'list', '--repo', repo, '--label', 'genie', '--state', 'open', '--json', 'number,headRefName']));
    const issues = numbersOf(await exec('gh', ['issue', 'list', '--repo', repo, '--label', 'genie', '--state', 'open', '--json', 'number']));
    report.prsClosed = prs.length;
    report.issuesClosed = issues.length;
    if (!options.dryRun) {
      for (const n of prs) await exec('gh', ['pr', 'close', String(n), '--repo', repo, '--delete-branch']);
      for (const n of issues) await exec('gh', ['issue', 'close', String(n), '--repo', repo]);
    }
  }

  return report;
}
