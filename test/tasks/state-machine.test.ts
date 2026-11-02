import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canTransition, groupByColumn, isWorking, labelOf } from '#modules/tasks/utils/state-machine.ts';
import { isChangeFor } from '#modules/tasks/utils/live.ts';

test('the worker walks a card forward and never decides a review', () => {
  assert.equal(canTransition('backlog', 'in_progress', 'system'), true);
  assert.equal(canTransition('in_progress', 'review', 'system'), true);
  assert.equal(canTransition('review', 'done', 'system'), false);
  assert.equal(canTransition('backlog', 'review', 'system'), false);
});

test('a person only decides from review', () => {
  assert.equal(canTransition('review', 'done', 'human'), true);
  assert.equal(canTransition('review', 'in_progress', 'human'), true);
  assert.equal(canTransition('backlog', 'in_progress', 'human'), false);
  assert.equal(canTransition('done', 'review', 'human'), false);
});

test('working means claimed, not failed, and in a worker column', () => {
  const claimedAt = new Date();
  assert.equal(isWorking({ status: 'in_progress', error: null, claimedAt }), true);
  assert.equal(isWorking({ status: 'in_progress', error: 'boom', claimedAt }), false);
  assert.equal(isWorking({ status: 'in_progress', error: null, claimedAt: null }), false);
  assert.equal(isWorking({ status: 'review', error: null, claimedAt }), false);
});

test('every card lands in exactly its column, in board order', () => {
  const columns = groupByColumn([{ status: 'done' as const }, { status: 'backlog' as const }]);
  assert.deepEqual(columns.map((c) => c.status), ['backlog', 'in_progress', 'review', 'done']);
  assert.equal(columns[0].tasks.length, 1);
  assert.equal(columns[3].tasks.length, 1);
  assert.equal(labelOf('in_progress'), 'In progress');
});

test('a live message only reaches the page showing that project and task', () => {
  const m = { projectId: 'p', taskId: 't', status: 'review' };
  assert.equal(isChangeFor(m, 'p'), true);
  assert.equal(isChangeFor(m, 'other'), false);
  assert.equal(isChangeFor(m, 'p', 't'), true);
  assert.equal(isChangeFor(m, 'p', 'other'), false);
  assert.equal(isChangeFor('not an object', 'p'), false);
  assert.equal(isChangeFor(null, 'p'), false);
});
