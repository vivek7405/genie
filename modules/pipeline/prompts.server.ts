// Server-only: the prompts handed to Claude Code. Each is a Markdown template
// with {{placeholders}}. A missing value throws at the call site instead of
// reaching the agent as literal braces, and inserted values are never rescanned.
import { readFileSync } from 'node:fs';

export type PromptName = 'build' | 'revise' | 'fix-ci';

export function renderPrompt(name: PromptName, vars: Record<string, string>): string {
  const raw = readFileSync(new URL(`./prompts/${name}.md`, import.meta.url), 'utf8');
  return raw.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    if (!(key in vars)) throw new Error(`prompt ${name}: no value for {{${key}}}`);
    return vars[key];
  });
}

// Lowercase kebab-case, at most 30 characters, never empty.
export function slugify(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30).replace(/-+$/, '');
  return slug || 'task';
}
