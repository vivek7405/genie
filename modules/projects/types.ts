// Browser-safe types for the projects feature.
import type { Project } from '#db/schema.server.ts';

export type { Project };

export interface ConnectProjectInput {
  name: string;
  githubRepo: string;
  githubProjectNumber: number | null;
}

// owner/name: GitHub allows alphanumerics, hyphens, underscores and dots.
export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
