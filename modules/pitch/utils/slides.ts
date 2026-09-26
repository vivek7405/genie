// The pitch deck content as data, in the order the judging brief asks for it:
// the problem (one slide), the demo, how it solves the problem, how AI is
// used, key technical choices, what comes next. Browser-safe: no server
// imports, so a test can assert the six topics without rendering.
export interface Slide {
  id: string;
  kicker: string;
  title: string;
  lead?: string;
  points: string[];
  footnote?: string;
}

export const SLIDES: readonly Slide[] = [
  {
    id: 'problem',
    kicker: '1 · The problem',
    title: 'A small change still costs a whole developer loop',
    lead: 'A product manager writes a ticket. Days later someone frees up, rebuilds the context, cuts a branch, builds, deploys a preview, and asks for review. The idea was five minutes; the loop was the cost.',
    points: [
      'Teams have more well-scoped ideas than engineers to run the loop for each one.',
      'AI coding agents exist, but they live in a terminal: nobody connects them to the tracker on one side and the deploy pipeline on the other.',
      'Assumption we state up front: the task is small and lands on an existing repository that already has conventions and tests.',
    ],
  },
  {
    id: 'demo',
    kicker: '2 · The prototype',
    title: 'genie: an async project manager that ships the card',
    lead: 'Connect a repo and its GitHub project board. Write a task. Come back to a pull request with a live preview URL.',
    points: [
      'Connect: a GitHub repo, its project board, and the genie label that opts a card in.',
      'Create a task in genie or on the GitHub board. It lands in Todo.',
      'Watch it move: Todo, Planning, In progress, Ready for review. The board updates live.',
      'Review the PR and click the preview. Approve to merge; pilots deploys the default branch.',
    ],
    footnote: 'Live demo on the board.',
  },
  {
    id: 'solution',
    kicker: '3 · How it solves the problem',
    title: 'The tracker is the interface; genie owns the middle',
    points: [
      'Humans own Todo and the verdict. genie owns Planning, In progress and Ready for review, and never overwrites a human-owned state.',
      'One state machine in SQLite is the queue, the audit log and the board. Every step is a line in the card’s activity feed.',
      'The deliverable is a real branch, a real pull request and a real preview environment, not a chat transcript.',
      'Works from either side: the genie kanban or the GitHub project board, kept in sync.',
    ],
  },
  {
    id: 'ai',
    kicker: '4 · How AI is used',
    title: 'Claude Code, headless, inside a throwaway microVM per task',
    points: [
      'Each task gets its own pilots sandbox (Firecracker microVM) restored from a base checkpoint with git, gh and Claude Code preinstalled.',
      'Planning: one short, timeboxed run that reads the issue and the repo’s own AGENTS.md and writes a compact plan, posted to the issue.',
      'Building: the agent implements the plan on a branch, runs the project’s own checks and tests, commits per logical unit and opens the PR.',
      'Nothing is scripted or canned: the plan, the code and the PR are produced by the model against the real repository.',
    ],
  },
  {
    id: 'choices',
    kicker: '5 · Key technical choices',
    title: 'Two open-source primitives and a strict credential rule',
    points: [
      'WebJs: a buildless, server-first web framework. Pages render as HTML, islands hydrate where needed, frames and WebSockets give the live board with almost no client code.',
      'pilots: sandboxes and services on one primitive. A machine costs nothing while idle, wakes on request, and the GitHub App gives every PR a preview URL and deploys on merge.',
      'GitHub stays the mirror, not the source of truth: no webhooks needed, one GraphQL query per project per tick, REST everywhere else.',
      'The Claude credential rides as the environment of one process inside the machine and is never written to disk, so a snapshot or a fork carries nothing.',
    ],
  },
  {
    id: 'next',
    kicker: '6 · What we would build next',
    title: 'From one task at a time to a team’s backlog',
    points: [
      'Review feedback loop: PR review comments become revise runs on the same branch.',
      'Cancel and steer from the board: removing the genie label mid-run stops the agent and closes its PR; a comment redirects it. Today the label is a one-way opt-in at pick-up.',
      'Parallel tasks with per-repo locks, cost and time budgets, and rate-limit backoff on the subscription window.',
      'Agent-written tests as a merge gate, and a second agent that reviews before a human does.',
      'Monorepos and non-WebJs stacks (pilots already detects Next, Rails, Django, Go), then a hosted genie.',
    ],
  },
];
