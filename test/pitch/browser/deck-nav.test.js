// The navigation island upgrades, counts, and answers the arrow keys.
import { fixture, waitForUpdate } from '@webjsdev/core/testing';
import '#modules/pitch/components/deck-nav.ts';

const assert = {
  equal(a, b) { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); },
};

suite('<deck-nav>', () => {
  test('arrow keys move the counter within bounds', async () => {
    const host = await fixture(`
      <div>
        <section id="slide-1">one</section>
        <section id="slide-2">two</section>
        <deck-nav total="2"></deck-nav>
      </div>
    `);
    const nav = host.querySelector('deck-nav');
    await waitForUpdate(nav);
    assert.equal(nav.textContent.includes('1 / 2'), true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await waitForUpdate(nav);
    assert.equal(nav.textContent.includes('2 / 2'), true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await waitForUpdate(nav);
    assert.equal(nav.textContent.includes('2 / 2'), true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    await waitForUpdate(nav);
    assert.equal(nav.textContent.includes('1 / 2'), true);
    host.remove();
  });
});
