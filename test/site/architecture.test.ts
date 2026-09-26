// The two architecture pages render under the site shell, carry their
// sections and their drawn figures, and link to each other and from the
// footer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appDir } from '../helpers/db.ts';
import { createRequestHandler } from '@webjsdev/server';
import { testRequest } from '@webjsdev/server/testing';

const app = await createRequestHandler({ appDir, dev: true });

function headings(body: string): string[] {
  return [...body.matchAll(/<h2[^>]*>([^<]+)<\/h2>/g)].map((m) => m[1].trim());
}

test('/architecture tells the shape: the layers, the rules, the costs, with a figure', async () => {
  const res = await testRequest(app.handle, '/architecture');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /aria-label="Main"/, 'renders in the site shell');
  assert.match(body, /<title>Architecture · genie<\/title>/);
  const h2 = headings(body);
  for (const h of [
    'The whole system, as five layers',
    'Five rules the rest is bent around',
    'One process, and that is the whole deployment',
    'GitHub is a mirror, and a label is the switch',
    'A machine per task, forked rather than booted',
    'Plan, build, self-review, and the pull request is the deliverable',
    'Approve merges, and the platform deploys',
    'A redeploy is a power cut, and the design assumes one',
    'What this design costs',
  ]) assert.ok(h2.includes(h), `heading: ${h}`);
  assert.match(body, /<svg[^>]*role="img"/, 'the overview is a drawn figure');
  assert.match(body, /href="\/architecture\/internals"/, 'links to the internals');
  assert.match(body, /<footer[\s\S]*href="\/architecture"[\s\S]*href="\/brand"/, 'the footer carries Architecture before Brand');
  assert.doesNotMatch(body, /\u2014/, 'no em-dashes');
});

test('/architecture/internals goes mechanism by mechanism, each with a figure', async () => {
  const res = await testRequest(app.handle, '/architecture/internals');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /aria-label="Main"/, 'renders in the site shell');
  assert.match(body, /<title>Internals · genie<\/title>/);
  const h2 = headings(body);
  for (const h of [
    'The whole idea, before any of the detail',
    'The state machine, and who may move a card',
    'A claim is a timestamp, and a stale one is a crash',
    'Two requests per project per pass',
    'Forked from a checkpoint, never booted',
    'One process holds the tokens, and no file does',
    'Plan, build, self-review, preview',
    'Five signals, two verdicts',
    'A redeploy is a power cut',
    'The words this page leans on',
    'The budgets, as written',
  ]) assert.ok(h2.includes(h), `heading: ${h}`);
  const figures = body.match(/<figure/g) ?? [];
  assert.ok(figures.length >= 8, `eight figures, got ${figures.length}`);
  assert.equal((body.match(/<svg[^>]*role="img"/g) ?? []).length, figures.length, 'every figure is an svg with a label');
  assert.match(body, /fill="var\(--ink\)"/, 'figures paint the live tokens');
  assert.match(body, /href="\/architecture"/, 'links back to the architecture page');
  assert.match(body, /<footer[\s\S]*href="\/architecture"/, 'the footer link is present here too');
  assert.doesNotMatch(body, /\u2014/, 'no em-dashes');
});

test('the header nav does not carry Architecture', async () => {
  const body = await (await testRequest(app.handle, '/')).text();
  const mainNav = body.match(/<nav[^>]*aria-label="Main"[^>]*>([\s\S]*?)<\/nav>/)?.[1] ?? '';
  assert.doesNotMatch(mainNav, /href="\/architecture"/);
  assert.match(body, /<footer[\s\S]*href="\/architecture"/, 'the home footer links it');
});
