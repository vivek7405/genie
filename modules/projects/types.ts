// Browser-safe types for the projects feature.
import type { Project } from '#db/schema.server.ts';

export type { Project };

export interface ConnectProjectInput {
  name: string;
  githubRepo: string;
  // The board to link, null for none. Ignored when createBoard is set.
  githubProjectNumber: number | null;
  // The GitHub App installation the repository was picked from; null on the
  // operator form (no App configured).
  installationId: number | null;
  // Create a board for the repository instead of linking an existing one.
  createBoard: boolean;
}

// owner/name: GitHub allows alphanumerics, hyphens, underscores and dots.
export const GITHUB_REPO_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+$/;
