// The island upgrades in a real browser and renders its connection state. The
// message filter is covered by a server test.
import { fixture, waitForUpdate } from '@webjsdev/core/testing';
import '#modules/tasks/components/live-refresh.ts';

suite('<live-refresh>', () => {
  test('upgrades and shows its connection state', async () => {
    const el = await fixture('<live-refresh project-id="p1" task-id="t1" frame="task"></live-refresh>');
    await waitForUpdate(el);
    if (el.projectId !== 'p1' || el.taskId !== 't1' || el.frame !== 'task') throw new Error('attributes did not reach the properties');
    if (!/Connecting|Live/.test(el.textContent)) throw new Error(`unexpected text: ${el.textContent}`);
    el.remove();
  });
});
