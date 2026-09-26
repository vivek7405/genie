// Server-only: where a project's default branch deploys on Pilots. Pilots has
// no repo-to-URL lookup: GET /v1/repos lists connections only, so the answer
// comes from the services list, the same rule hostd's serviceFor applies to a
// push (the newest service on this repo whose tracked branch matches). Read on
// every approve, since a service may be connected after the project was.
import type { Service } from '@pilots/sdk';
import type { Project } from '#modules/projects/types.ts';
import { pilots } from './pilots.server.ts';

export type ListServices = () => Promise<Service[]>;

// No key means no Pilots: the board keeps working in dev with no URL.
const defaultListServices: ListServices = async () => {
  if (!process.env.PILOT_API_KEY) return [];
  return pilots().services.list();
};

export async function findProductionUrl(
  project: Pick<Project, 'githubRepo' | 'defaultBranch'>,
  listServices: ListServices = defaultListServices,
): Promise<string | null> {
  const services = await listServices();
  const match = services
    .filter((s) => s.repo === project.githubRepo && s.autodeploy && (!s.branch || s.branch === project.defaultBranch))
    .sort((a, b) => b.created_at - a.created_at)[0];
  if (!match) return null;
  return match.custom_domain ? `https://${match.custom_domain}` : match.url ?? null;
}
