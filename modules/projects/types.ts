// Browser-safe project types and rules.
import type { Project } from '#db/schema.server.ts';

export type { Project };

export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

// Accepts owner/name, or a pasted GitHub URL.
export function normalizeRepo(raw: string): string {
  return raw.trim().replace(/^https?:\/\/github\.com\//, '').replace(/^git@github\.com:/, '').replace(/\.git$/, '').replace(/\/+$/, '');
}
