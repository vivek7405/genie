// The live-refresh island upgrades in a real browser and renders its
// connection state. The socket itself is not exercised here (the message
// filter is covered by a Node test); connectWS simply retries in the
// background when no server answers.
import { fixture, waitForUpdate } from '@webjsdev/core/testing';
import '#modules/tasks/components/live-refresh.ts';

const assert = {
  equal(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
  match(s, re) { if (!re.test(s)) throw new Error(`expected ${JSON.stringify(s)} to match ${re}`); },
};

suite('<live-refresh>', () => {
  test('upgrades and shows the disconnected state first', async () => {
    const el = await fixture('<live-refresh project-id="p1" frame="board"></live-refresh>');
    await waitForUpdate(el);
    assert.equal(el.projectId, 'p1');
    assert.equal(el.frame, 'board');
    assert.match(el.textContent, /connecting|live/);
    el.remove();
  });
});
