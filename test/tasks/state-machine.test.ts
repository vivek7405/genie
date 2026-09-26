import { test } from 'node:test';
import assert from 'node:assert/strict';
import { COLUMNS, canTransition, groupByColumn, isSystemOwned, nextSystemStatus } from '#modules/tasks/utils/state-machine.ts';
import { isBoardChangeFor } from '#modules/tasks/utils/live.ts';

test('the system walks todo -> planning -> in_progress -> ready_for_review and stops', () => {
  assert.equal(nextSystemStatus('todo'), 'planning');
  assert.equal(nextSystemStatus('planning'), 'in_progress');
  assert.equal(nextSystemStatus('in_progress'), 'ready_for_review');
  assert.equal(nextSystemStatus('ready_for_review'), null);
  assert.equal(nextSystemStatus('done'), null);
});

test('only a human moves a task out of ready_for_review', () => {
  assert.equal(canTransition('ready_for_review', 'done', 'human'), true);
  assert.equal(canTransition('ready_for_review', 'in_progress', 'human'), true);
  assert.equal(canTransition('ready_for_review', 'done', 'system'), false);
  assert.equal(canTransition('todo', 'planning', 'human'), false);
  assert.equal(canTransition('todo', 'planning', 'system'), true);
  assert.equal(canTransition('in_progress', 'done', 'human'), false);
});

test('a failed task is no longer system owned until retried', () => {
  assert.equal(isSystemOwned({ status: 'planning', error: null }), true);
  assert.equal(isSystemOwned({ status: 'planning', error: 'boom' }), false);
  assert.equal(isSystemOwned({ status: 'ready_for_review', error: null }), false);
});

test('groupByColumn keeps column order and buckets by status', () => {
  const grouped = groupByColumn([{ status: 'done' }, { status: 'todo' }, { status: 'todo' }]);
  assert.deepEqual(grouped.map((c) => c.status), COLUMNS.map((c) => c.status));
  assert.equal(grouped[0].tasks.length, 2);
  assert.equal(grouped[4].tasks.length, 1);
});

test('isBoardChangeFor filters broadcasts to the board being shown', () => {
  assert.equal(isBoardChangeFor({ projectId: 'p1', taskId: 't', status: 'todo' }, 'p1'), true);
  assert.equal(isBoardChangeFor({ projectId: 'p2', taskId: 't', status: 'todo' }, 'p1'), false);
  assert.equal(isBoardChangeFor('hello', 'p1'), false);
  assert.equal(isBoardChangeFor(null, 'p1'), false);
});
