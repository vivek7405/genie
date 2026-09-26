// Server-only: the Projects v2 board, the one GraphQL consumer. Ids are
// resolved once at connect (resolveBoard) and stored on the project row.
import { eq } from 'drizzle-orm';
import { db } from '#db/connection.server.ts';
import { projects } from '#db/schema.server.ts';
import type { Project } from '#modules/projects/types.ts';
import { TASK_STATUSES, type TaskStatus } from '#modules/tasks/types.ts';
import { GithubError, ghGraphql, viaInstallation } from './client.server.ts';

// The board option for each genie status. Matched loosely against what the
// board has ("In Progress" on a default board), created with this spelling.
export const STATUS_OPTION_NAMES: Record<TaskStatus, string> = {
  todo: 'Todo',
  planning: 'Plan',
  in_progress: 'In progress',
  ready_for_review: 'Review',
  done: 'Done',
};
const OPTION_COLORS: Record<TaskStatus, string> = { todo: 'GREEN', planning: 'BLUE', in_progress: 'YELLOW', ready_for_review: 'ORANGE', done: 'PURPLE' };

export const normalizeOptionName = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');

// The genie status a board option id maps to, or null for an option genie
// does not own (a board may carry columns of its own).
export function statusForOption(project: Pick<Project, 'statusOptionIds'>, optionId: string | null | undefined): TaskStatus | null {
  if (!optionId || !project.statusOptionIds) return null;
  return TASK_STATUSES.find((s) => project.statusOptionIds?.[s] === optionId) ?? null;
}

interface BoardOption { id: string; name: string; color: string; description: string }
interface BoardQuery { repositoryOwner: { projectV2: { id: string; field: { id: string; options: BoardOption[] } | null } | null } | null }

const BOARD_QUERY = `query($owner: String!, $number: Int!) {
  repositoryOwner(login: $owner) { ... on ProjectV2Owner { projectV2(number: $number) {
    id field(name: "Status") { ... on ProjectV2SingleSelectField { id options { id name color description } } } } } } }`;

const UPDATE_FIELD = `mutation($fieldId: ID!, $options: [ProjectV2SingleSelectFieldOptionInput!]!) {
  updateProjectV2Field(input: { fieldId: $fieldId, singleSelectOptions: $options }) {
    projectV2Field { ... on ProjectV2SingleSelectField { id options { id name color description } } } } }`;

const ITEM_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { issue(number: $number) {
    id projectItems(first: 10) { nodes { id project { id } } } } } }`;

const ADD_ITEM = `mutation($projectId: ID!, $contentId: ID!) {
  addProjectV2ItemById(input: { projectId: $projectId, contentId: $contentId }) { item { id } } }`;

const MOVE_ITEM = `mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
  updateProjectV2ItemFieldValue(input: { projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId } }) {
    projectV2Item { id } } }`;

const ITEMS_QUERY = `query($projectId: ID!) {
  node(id: $projectId) { ... on ProjectV2 { items(first: 100) { pageInfo { hasNextPage } nodes {
    id fieldValueByName(name: "Status") { ... on ProjectV2ItemFieldSingleSelectValue { optionId } }
    content { ... on Issue { number state } } } } } } }`;

const findOption = (options: BoardOption[], status: TaskStatus) =>
  options.find((o) => normalizeOptionName(o.name) === normalizeOptionName(STATUS_OPTION_NAMES[status]));

// Fills githubProjectId, statusFieldId and statusOptionIds, creating the
// Status options genie needs. Returns the updated row. Throws GithubError.
export async function resolveBoard(project: Project): Promise<Project> {
  if (!project.githubProjectNumber) return project;
  const owner = project.githubRepo.split('/')[0];
  const data = await ghGraphql<BoardQuery>(BOARD_QUERY, { owner, number: project.githubProjectNumber }, { auth: viaInstallation(project) });
  const board = data.repositoryOwner?.projectV2;
  if (!board) throw new GithubError(`Project #${project.githubProjectNumber} was not found under ${owner}. Check the number and that the token has the project scope.`, 404);
  if (!board.field) throw new GithubError('The board has no single-select Status field.', 422);
  let options = board.field.options;
  const missing = TASK_STATUSES.filter((s) => !findOption(options, s));
  if (missing.length) {
    // updateProjectV2Field REPLACES the option list. Every existing option is
    // re-sent with its id so no card loses its Status; the new ones follow.
    const updated = await ghGraphql<{ updateProjectV2Field: { projectV2Field: { options: BoardOption[] } } }>(UPDATE_FIELD, {
      fieldId: board.field.id,
      options: [
        ...options.map((o) => ({ id: o.id, name: o.name, color: o.color, description: o.description })),
        ...missing.map((s) => ({ name: STATUS_OPTION_NAMES[s], color: OPTION_COLORS[s], description: 'Set by genie' })),
      ],
    }, { auth: viaInstallation(project) });
    options = updated.updateProjectV2Field.projectV2Field.options;
  }
  const statusOptionIds: Partial<Record<TaskStatus, string>> = {};
  for (const s of TASK_STATUSES) statusOptionIds[s] = findOption(options, s)?.id;
  const [row] = await db
    .update(projects)
    .set({ githubProjectId: board.id, statusFieldId: board.field.id, statusOptionIds, syncError: null })
    .where(eq(projects.id, project.id))
    .returning();
  return row;
}

function requireBoard(project: Project): { projectId: string; fieldId: string } {
  if (!project.githubProjectId || !project.statusFieldId) throw new GithubError('The board is not resolved. Reconnect the project.', 422);
  return { projectId: project.githubProjectId, fieldId: project.statusFieldId };
}

// The board item for an issue, from the issue node (1 point), never a dump.
export async function itemIdForIssue(project: Project, issueNumber: number): Promise<string | null> {
  const { projectId } = requireBoard(project);
  const [owner, name] = project.githubRepo.split('/');
  const data = await ghGraphql<{ repository: { issue: { projectItems: { nodes: { id: string; project: { id: string } }[] } } | null } }>(ITEM_QUERY, { owner, name, number: issueNumber }, { auth: viaInstallation(project) });
  return data.repository.issue?.projectItems.nodes.find((n) => n.project.id === projectId)?.id ?? null;
}

// Idempotent on GitHub's side: an issue already on the board returns its item.
export async function addIssueToBoard(project: Project, issueNodeId: string): Promise<string> {
  const { projectId } = requireBoard(project);
  const data = await ghGraphql<{ addProjectV2ItemById: { item: { id: string } } }>(ADD_ITEM, { projectId, contentId: issueNodeId }, { auth: viaInstallation(project) });
  return data.addProjectV2ItemById.item.id;
}

export async function moveItem(project: Project, itemId: string, status: TaskStatus): Promise<void> {
  const { projectId, fieldId } = requireBoard(project);
  const optionId = project.statusOptionIds?.[status];
  if (!optionId) throw new GithubError(`The board has no option for ${status}. Reconnect the project.`, 422);
  await ghGraphql(MOVE_ITEM, { projectId, itemId, fieldId, optionId }, { auth: viaInstallation(project) });
}

export interface BoardItem { itemId: string; optionId: string | null; issueNumber: number | null; open: boolean }

// One request per tick: the first 100 items with their Status option and
// issue number. Labels and bodies come from REST (issues.server.ts).
// `content` is null for a draft item or a pull request, so issueNumber is
// nullable and the sync skips those.
export async function listBoardItems(project: Project): Promise<{ items: BoardItem[]; truncated: boolean }> {
  const { projectId } = requireBoard(project);
  const data = await ghGraphql<{ node: { items: { pageInfo: { hasNextPage: boolean }; nodes: { id: string; fieldValueByName: { optionId: string } | null; content: { number: number; state: string } | null }[] } } }>(ITEMS_QUERY, { projectId }, { auth: viaInstallation(project) });
  return {
    truncated: data.node.items.pageInfo.hasNextPage,
    items: data.node.items.nodes.map((n) => ({ itemId: n.id, optionId: n.fieldValueByName?.optionId ?? null, issueNumber: n.content?.number ?? null, open: n.content?.state === 'OPEN' })),
  };
}
