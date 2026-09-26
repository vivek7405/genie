// The pitch deck content as data, in the order the judging brief asks for it.
// The problem (one slide), how it solves the problem, how AI is used, key
// technical choices, what comes next. The demo itself is live, not a slide. Browser-safe, so
// a test can assert the five topics without rendering. Deck prose avoids colons,
// semicolons and em-dashes on purpose.
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
    title: 'Every change still costs a whole developer loop',
    lead: 'A product manager writes a ticket. Days later someone frees up, rebuilds the context, cuts a branch, builds, deploys a preview, and asks for review. The idea took five minutes and the loop was the cost.',
    points: [
      'Teams have more well-scoped ideas than engineers to run the loop for each one.',
      'AI coding agents exist, but they live in a terminal. Nobody connects them to the tracker on one side and the deploy pipeline on the other.',
      'The loop is the same whether the ticket is a copy fix or a whole new app, so the tracker should be able to run it for anything you put on the board.',
    ],
  },
  {
    id: 'solution',
    kicker: '2 · How it solves the problem',
    title: 'The tracker is the interface',
    points: [
      'You own Todo, Review and Done. Genie owns Plan and In progress, and never overwrites a column you own.',
      'One state machine in SQLite is the queue, the audit log and the board. Every step is a line in the card’s activity feed.',
      'The deliverable is a real branch, a real pull request and a real preview environment, not a chat transcript.',
      'Works from either side, the Genie kanban or the GitHub project board, kept in sync both ways.',
    ],
    footnote: 'Live demo on the board.',
  },
  {
    id: 'ai',
    kicker: '3 · How AI is used',
    title: 'Claude Code, headless, in a machine per task',
    points: [
      'Each task gets its own Pilots sandbox, a machine restored from a base checkpoint with git, gh and Claude Code preinstalled.',
      'Planning is one short, timeboxed run that reads the issue and the repo’s own AGENTS.md and writes a compact plan, posted to the issue.',
      'Building is the agent implementing the plan on a branch, running the project’s own checks and tests, committing per logical unit and opening the PR.',
      'Before a human sees it, the agent reviews its own PR, fixes what it finds and leaves the review comments for you to read.',
      'Nothing is scripted or canned. The plan, the code and the PR are produced by the model against the real repository.',
    ],
  },
  {
    id: 'choices',
    kicker: '4 · Key technical choices',
    title: 'Built on WebJs and Pilots',
    points: [
      'WebJs is a buildless, server-first web framework. Pages render as HTML, islands hydrate where needed, frames and WebSockets give the live board with almost no client code.',
      'Pilots runs sandboxes and services on one primitive. A machine costs nothing while idle, wakes on request, and the GitHub App gives every PR a preview URL and deploys on merge.',
      'GitHub stays the mirror, not the source of truth. A webhook wakes a sync the moment a card or PR changes and a slow poll covers anything missed.',
      'The Claude credential rides as the environment of one process inside the machine and is never written to disk, so a snapshot or a fork carries nothing.',
    ],
  },
  {
    id: 'next',
    kicker: '5 · What we would build next',
    title: 'What comes next',
    points: [
      'Cancel and steer from the board. Removing the genie label mid-run stops the agent and closes its PR, and a comment redirects it. Today the label is a one-way opt-in at pick-up.',
      'Parallel tasks with per-repo locks, cost and time budgets, and rate-limit backoff on the subscription window.',
      'Agent-written tests as a merge gate, so a PR cannot reach Review without proving itself.',
      'Open the sandbox to the reviewer. Pilots already lets a person take over the code an agent wrote inside a machine, through its VS Code plugin or a terminal for the nerds, so a card could hand you the live sandbox, not only the pull request.',
      'Promote the database from SQLite to Postgres once more than one replica or one team shares a Genie.',
      'Monorepos and non-WebJs stacks (Pilots already detects Next, Rails, Django, Go), then a hosted Genie.',
    ],
  },
];
