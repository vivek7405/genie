// Server-only: the prompts the stages hand to Claude Code. Each one is a
// Markdown template under ./prompts with {{placeholders}}; renderPrompt fills
// every one and refuses a template whose value is missing, so a renamed
// variable fails at the call site instead of reaching the agent as literal
// braces. Inserted values are never rescanned, so a task description that
// happens to contain {{x}} stays as written.
import { readFileSync } from 'node:fs';

// #5 adds 'revise'.
export type PromptName = 'plan' | 'build';

export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  const raw = readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), 'utf8');
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`prompt ${name}: no value for {{${key}}}`);
    return vars[key];
  });
}

// The branch slug for a task title: lowercase kebab-case, at most 30
// characters, no leading or trailing dash, and never empty.
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/, '');
  return slug || 'task';
}
