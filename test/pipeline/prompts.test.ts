// The prompt templates and their renderer: every placeholder filled, a
// missing one named, and the branch slug rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { renderPrompt, slugify } = await import('#modules/pipeline/prompts.server.ts');

const PLAN_VARS = {
  repo: 'harness/stages',
  appDir: '/home/pilot/app',
  maxTurns: '12',
  issueRef: 'Issue #4',
  title: 'Add an about page',
  description: 'A page at /about with the team list.',
  stackNote: 'This repository already has code.',
  planPath: '/home/pilot/PLAN.md',
};

const BUILD_VARS = {
  ...PLAN_VARS,
  plan: '## Stack\nexisting: WebJs',
  branch: 'genie/4-add-an-about-page',
  defaultBranch: 'main',
  closesLine: 'Closes #4',
};

test('renderPrompt fills every placeholder of the plan prompt', () => {
  const out = renderPrompt('plan', PLAN_VARS);
  assert.ok(!out.includes('{{'), 'no placeholder survives');
  assert.ok(out.includes('`harness/stages` at `/home/pilot/app`'));
  assert.ok(out.includes('Issue #4: Add an about page'));
  assert.ok(out.includes('A page at /about with the team list.'));
  assert.ok(out.includes('12 tool calls'));
  assert.ok(out.includes('Write the plan to `/home/pilot/PLAN.md`'));
  assert.ok(out.includes('## Stack'));
  assert.ok(out.includes('Your final message is the single word DONE.'));
});

const REVISE_VARS = {
  repo: 'harness/stages',
  appDir: '/home/pilot/app',
  issueRef: 'Issue #4',
  prNumber: '7',
  branch: 'genie/4-add-an-about-page',
  defaultBranch: 'main',
  feedback: 'make it dark mode',
  threads: '- thread 501 by vivek7405 on app/page.ts:12: rename this',
  plan: '## Stack\nexisting: WebJs',
};

test('renderPrompt fills every placeholder of the revise prompt', () => {
  const out = renderPrompt('revise', REVISE_VARS);
  assert.ok(!out.includes('{{'), 'no placeholder survives');
  assert.ok(out.includes('make it dark mode'));
  assert.ok(out.includes('git checkout genie/4-add-an-about-page && git pull --ff-only origin genie/4-add-an-about-page'));
  assert.ok(out.includes('gh api repos/harness/stages/pulls/7/comments/<thread id>/replies'));
  assert.ok(out.includes('gh pr edit 7 --add-reviewer'));
  assert.ok(out.includes('- thread 501 by vivek7405 on app/page.ts:12: rename this'));
  assert.ok(out.includes('Do not open a new PR'));
  assert.ok(out.includes('REVISION_BLOCKED.md'));
  assert.ok(!out.includes(String.fromCharCode(0x2014)), 'no em-dash');
});

test('renderPrompt fills every placeholder of the build prompt', () => {
  const out = renderPrompt('build', BUILD_VARS);
  assert.ok(!out.includes('{{'), 'no placeholder survives');
  assert.ok(out.includes('## Stack\nexisting: WebJs'));
  assert.ok(out.includes('Work on the branch `genie/4-add-an-about-page`'));
  assert.ok(out.includes('Create it from `main`'));
  assert.ok(out.includes('Its first line is `Closes #4`.'));
  assert.ok(out.includes('gh pr list --head genie/4-add-an-about-page --json number,url --state open'));
  assert.ok(out.includes('gh pr create --base main --head genie/4-add-an-about-page'));
  assert.ok(out.includes('npm create webjs@latest <dir> -- --db sqlite --runtime node'));
  assert.ok(out.includes('Never commit `/home/pilot/PLAN.md`'));
});

test('renderPrompt throws naming the placeholder that has no value', () => {
  const { closesLine: _dropped, ...rest } = BUILD_VARS;
  assert.throws(() => renderPrompt('build', rest), /prompt build: no value for \{\{closesLine\}\}/);
});

test('renderPrompt does not rescan the inserted values', () => {
  const out = renderPrompt('plan', { ...PLAN_VARS, description: 'Render {{title}} literally.' });
  assert.ok(out.includes('Render {{title}} literally.'));
});

test('the prompts carry no em-dash and no space-surrounded hyphen', () => {
  for (const name of ['plan', 'build'] as const) {
    const out = renderPrompt(name, BUILD_VARS);
    assert.ok(!out.includes(String.fromCharCode(0x2014)), `${name}: no em-dash`);
    assert.ok(!/\S -{1,2} \S/.test(out.replace(/`[^`]*`/g, '')), `${name}: no hyphen used as a pause`);
  }
});

test('slugify makes a short kebab-case slug and never an empty one', () => {
  assert.equal(slugify('Add a /about page with team list'), 'add-a-about-page-with-team-lis');
  assert.equal(slugify('  Hello, World!  '), 'hello-world');
  assert.equal(slugify('!!! ???'), 'task');
  assert.equal(slugify('x'.repeat(29) + '-y'), 'x'.repeat(29));
});
