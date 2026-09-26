// `npm run db:seed`: a project and a few tasks so the board renders real rows
// while building. Idempotent on the repo name.
import { db } from './connection.server.ts';
import { projects, tasks } from './schema.server.ts';

const repo = 'vivek7405/genie';
const existing = await db.query.projects.findFirst({ where: { githubRepo: repo } });
const project = existing ?? (await db.insert(projects).values({ name: 'genie', githubRepo: repo, githubProjectNumber: 11 }).returning())[0];

if (!existing) {
  await db.insert(tasks).values([
    { projectId: project.id, title: 'Add a /about page', description: 'A short page describing what genie does, linked from the header.' },
    { projectId: project.id, title: 'Show task counts in the header', description: 'A small badge per column.', status: 'ready_for_review', previewUrl: 'https://pr-2-genie.pilotrun.app' },
    { projectId: project.id, title: 'Dark mode toggle', status: 'done' },
  ]);
}
console.log(`seeded project ${project.id}`);
