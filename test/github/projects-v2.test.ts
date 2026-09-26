// The Projects v2 board over a scripted fake: resolving the Status field and
// its options at connect, the item lookup, adding and moving cards.
import { test, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { db } from '../helpers/db.ts';
import { fakeGithub, jsonResponse } from '../helpers/github.ts';
import { projects } from '#db/schema.server.ts';
import { GithubError, setGithubTransport } from '#modules/github/client.server.ts';
import { addIssueToBoard, itemIdForIssue, listBoardItems, moveItem, resolveBoard, statusForOption } from '#modules/github/projects-v2.server.ts';

const fake = fakeGithub();
setGithubTransport(fake.transport);
after(() => setGithubTransport(null));
beforeEach(() => {
  fake.reset();
  fake.graphql.length = 0;
});

// The live board's shape before genie touched it: four options, one of them
// not genie's, and "In Progress" spelled with a capital P.
const defaultOptions = [
  { id: 'todo-id', name: 'Todo', color: 'GREEN', description: '' },
  { id: 'ready-id', name: 'Ready', color: 'BLUE', description: 'Groomed' },
  { id: 'ip-id', name: 'In Progress', color: 'YELLOW', description: '' },
  { id: 'done-id', name: 'Done', color: 'PURPLE', description: '' },
];
const allOptions = [
  ...defaultOptions,
  { id: 'plan-id', name: 'Plan', color: 'BLUE', description: 'Set by genie' },
  { id: 'review-id', name: 'Review', color: 'ORANGE', description: 'Set by genie' },
];

let n = 0;
async function newProject(patch: Partial<typeof projects.$inferInsert> = {}) {
  const [row] = await db.insert(projects).values({ name: 'p', githubRepo: `harness/p2-${Date.now()}-${n++}`, githubProjectNumber: 11, ...patch }).returning();
  return row;
}

function boardWith(options: typeof defaultOptions) {
  fake.onGraphql('repositoryOwner', () => ({ repositoryOwner: { projectV2: { id: 'PVT_1', field: { id: 'FIELD_1', options } } } }));
}

test('resolveBoard creates the missing options while re-sending the existing ones with their ids', async () => {
  boardWith(defaultOptions);
  let sent: { id?: string; name: string; color: string; description: string }[] = [];
  fake.onGraphql('updateProjectV2Field', (variables) => {
    sent = variables.options as typeof sent;
    return { updateProjectV2Field: { projectV2Field: { id: 'FIELD_1', options: allOptions } } };
  });
  const row = await resolveBoard(await newProject());
  const mutations = fake.calls.filter((c) => String(c.body?.query).includes('updateProjectV2Field'));
  assert.equal(mutations.length, 1, 'exactly one field update');
  assert.equal(sent.length, 6);
  assert.deepEqual(sent[2], { id: 'ip-id', name: 'In Progress', color: 'YELLOW', description: '' });
  assert.deepEqual(sent.slice(4).map((o) => o.name), ['Plan', 'Review']);
  assert.ok(sent.slice(4).every((o) => o.id === undefined && o.color && o.description));
  assert.equal(row.githubProjectId, 'PVT_1');
  assert.equal(row.statusFieldId, 'FIELD_1');
  assert.deepEqual(row.statusOptionIds, { todo: 'todo-id', planning: 'plan-id', in_progress: 'ip-id', ready_for_review: 'review-id', done: 'done-id' });
  assert.equal(row.syncError, null);
});

test('resolveBoard sends no mutation when every option exists', async () => {
  boardWith(allOptions);
  const row = await resolveBoard(await newProject({ syncError: 'old failure' }));
  assert.equal(fake.calls.length, 1, 'one query, no mutation');
  assert.equal(row.statusOptionIds?.ready_for_review, 'review-id');
  assert.equal(row.syncError, null, 'a successful resolve clears the stored error');
});

test('a wrong number and a scope error both throw and leave the row untouched', async () => {
  fake.onGraphql('repositoryOwner', () => ({ repositoryOwner: { projectV2: null } }));
  const missing = await newProject();
  const err = await resolveBoard(missing).catch((e: unknown) => e);
  assert.ok(err instanceof GithubError);
  assert.equal(err.status, 404);
  assert.match(err.message, /Project #11 was not found under harness/);

  fake.graphql.length = 0;
  fake.onGraphql('repositoryOwner', () => jsonResponse({ errors: [{ type: 'INSUFFICIENT_SCOPES', message: 'Your token has not been granted the required scopes' }] }));
  const scoped = await resolveBoard(missing).catch((e: unknown) => e);
  assert.ok(scoped instanceof GithubError);
  assert.equal(scoped.status, 403);
  const row = await db.query.projects.findFirst({ where: { id: missing.id } });
  assert.equal(row?.githubProjectId, null);
  assert.equal(row?.statusOptionIds, null);
});

test('a board without a Status field is a 422', async () => {
  fake.onGraphql('repositoryOwner', () => ({ repositoryOwner: { projectV2: { id: 'PVT_1', field: null } } }));
  const err = await resolveBoard(await newProject()).catch((e: unknown) => e);
  assert.ok(err instanceof GithubError);
  assert.equal(err.status, 422);
});

test('a project without a board number resolves to itself with no request', async () => {
  const project = await newProject({ githubProjectNumber: null });
  assert.equal(await resolveBoard(project), project);
  assert.equal(fake.calls.length, 0);
});

const resolved = { githubProjectId: 'PVT_1', statusFieldId: 'FIELD_1', statusOptionIds: { todo: 'todo-id', planning: 'plan-id', in_progress: 'ip-id', ready_for_review: 'review-id', done: 'done-id' } };

test('itemIdForIssue returns the item on this board, or null when the issue is elsewhere only', async () => {
  const project = await newProject(resolved);
  fake.onGraphql('projectItems', (variables) => ({
    repository: { issue: variables.number === 5
      ? { id: 'I_5', projectItems: { nodes: [{ id: 'ITEM_other', project: { id: 'PVT_other' } }, { id: 'ITEM_5', project: { id: 'PVT_1' } }] } }
      : { id: 'I_6', projectItems: { nodes: [{ id: 'ITEM_other', project: { id: 'PVT_other' } }] } } },
  }));
  assert.equal(await itemIdForIssue(project, 5), 'ITEM_5');
  assert.equal(await itemIdForIssue(project, 6), null);
  assert.deepEqual(fake.calls.at(-1)!.body?.variables, { owner: 'harness', name: project.githubRepo.split('/')[1], number: 6 });
});

test('addIssueToBoard and moveItem send the stored ids', async () => {
  const project = await newProject(resolved);
  fake.onGraphql('addProjectV2ItemById', (variables) => {
    assert.deepEqual(variables, { projectId: 'PVT_1', contentId: 'I_9' });
    return { addProjectV2ItemById: { item: { id: 'ITEM_9' } } };
  });
  assert.equal(await addIssueToBoard(project, 'I_9'), 'ITEM_9');
  let moved: Record<string, unknown> = {};
  fake.onGraphql('updateProjectV2ItemFieldValue', (variables) => {
    moved = variables;
    return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_9' } } };
  });
  await moveItem(project, 'ITEM_9', 'ready_for_review');
  assert.deepEqual(moved, { projectId: 'PVT_1', itemId: 'ITEM_9', fieldId: 'FIELD_1', optionId: 'review-id' });
});

test('moveItem throws when the board lacks the option, and the unresolved board throws before any request', async () => {
  const partial = await newProject({ ...resolved, statusOptionIds: { todo: 'todo-id' } });
  const err = await moveItem(partial, 'ITEM_1', 'planning').catch((e: unknown) => e);
  assert.ok(err instanceof GithubError);
  assert.match(err.message, /no option for planning/);
  const unresolved = await newProject();
  await assert.rejects(moveItem(unresolved, 'ITEM_1', 'todo'), /not resolved/);
  assert.equal(fake.calls.length, 0);
});

test('listBoardItems maps items, skips content that is not an issue, and reports truncation', async () => {
  const project = await newProject(resolved);
  fake.onGraphql('items(first: 100)', () => ({ node: { items: { pageInfo: { hasNextPage: true }, nodes: [
    { id: 'ITEM_1', fieldValueByName: { optionId: 'todo-id' }, content: { number: 1, state: 'OPEN' } },
    { id: 'ITEM_2', fieldValueByName: null, content: { number: 2, state: 'CLOSED' } },
    { id: 'ITEM_3', fieldValueByName: { optionId: 'done-id' }, content: null },
  ] } } }));
  const out = await listBoardItems(project);
  assert.equal(out.truncated, true);
  assert.deepEqual(out.items, [
    { itemId: 'ITEM_1', optionId: 'todo-id', issueNumber: 1, open: true },
    { itemId: 'ITEM_2', optionId: null, issueNumber: 2, open: false },
    { itemId: 'ITEM_3', optionId: 'done-id', issueNumber: null, open: false },
  ]);
});

test('statusForOption maps a stored option id to its status and unknown ids to null', () => {
  assert.equal(statusForOption(resolved, 'ip-id'), 'in_progress');
  assert.equal(statusForOption(resolved, 'ready-id'), null);
  assert.equal(statusForOption(resolved, null), null);
  assert.equal(statusForOption({ statusOptionIds: null }, 'ip-id'), null);
});
