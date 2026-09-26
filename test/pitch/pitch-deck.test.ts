import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDir } from '../helpers/db.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';
import { SLIDES } from '#modules/pitch/utils/slides.ts';

const app = await createRequestHandler({ appDir, dev: true });

test('the deck covers the five points the brief asks for, in order', () => {
  assert.deepEqual(SLIDES.map((s) => s.id), ['problem', 'solution', 'ai', 'choices', 'next']);
  for (const slide of SLIDES) assert.ok(slide.points.length >= 3, `${slide.id} has substance`);
});

test('/pitch-deck renders every slide and the navigation island', async () => {
  const res = await testRequest(app.handle, '/pitch-deck');
  assert.equal(res.status, 200);
  const body = await res.text();
  for (let i = 1; i <= SLIDES.length; i++) assert.match(body, new RegExp(`id="slide-${i}"`));
  assert.match(body, /<deck-nav/);
  assert.match(body, /Claude Code, headless/);
});
