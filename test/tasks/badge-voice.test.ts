// The filled badge keeps its own ink in the label voice. cn() cannot tell a
// font-size token from a colour, so the voice must be composed inside the
// helper, never appended at a call site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { badgeClass } from '#components/ui/badge.ts';

test('a voiced badge carries the label voice AND the variant colour', () => {
  const cls = badgeClass({ voice: true });
  assert.match(cls, /\btext-label\b/);
  assert.match(cls, /\btext-primary-foreground\b/);
  assert.doesNotMatch(cls, /\btext-xs\b/);
  assert.match(badgeClass({ variant: 'destructive', voice: true }), /\btext-white\b/);
  assert.match(badgeClass(), /\btext-xs\b/);
});

test('cn keeps a type step and a colour together', async () => {
  const { cn } = await import('#lib/utils/cn.ts');
  const out = cn('text-label text-muted-foreground', 'text-foreground');
  assert.match(out, /\btext-label\b/);
  assert.match(out, /\btext-foreground\b/);
  assert.doesNotMatch(out, /\btext-muted-foreground\b/, 'the later colour wins');
  assert.equal(cn('text-xs', 'text-meta'), 'text-meta', 'two sizes still collapse to the later one');
});
