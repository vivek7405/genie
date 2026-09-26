// /brand prints the palette the layout paints, from one source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDir } from '../helpers/db.ts';
import { signInAs } from '../helpers/auth.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest, withSessionCookie } from '@webjsdev/server/testing';
import { PALETTE } from '#lib/design/palette.ts';

const app = await createRequestHandler({ appDir, dev: true });
const me = withSessionCookie({}, (await signInAs('harness')).cookies);

test('the layout declares every palette token once, as a light-dark() pair', async () => {
  const body = await (await testRequest(app.handle, '/dashboard', me)).text();
  for (const s of PALETTE) {
    assert.match(body, new RegExp(`--${s.token}: light-dark\\(${s.light}, ${s.dark}\\);`), `${s.token} declared`);
  }
  assert.match(body, /--primary:\s*var\(--glow\)/, 'the accent is the glow');
});

test('/brand renders the mark and prints every printed swatch with its values', async () => {
  const res = await testRequest(app.handle, '/brand');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<svg viewBox="0 0 32 32"/);
  for (const s of PALETTE.filter((p) => p.print)) {
    assert.match(body, new RegExp(`${s.light} ${s.dark}`), `${s.token} printed`);
    assert.match(body, new RegExp(`sw-${s.token}`), `${s.token} painted`);
  }
  assert.match(body, /Writing the name/);
  assert.doesNotMatch(body.slice(0, body.indexOf('<footer')), /Pitch Deck/, 'the deck is linked from the footer, not the header');
});

test('the header carries the same mark as /brand', async () => {
  const home = await (await testRequest(app.handle, '/dashboard', me)).text();
  assert.match(home, /--logo-accent: var\(--glow\)/);
  assert.match(home, /<circle cx="22.5" cy="8.5" r="5.5"/);
});
