# AGENTS.md for genie

**Genie specifics.** The gallery is already cleared, so skip the "study the gallery"
step below. The product is a kanban board whose worker lives in `modules/pipeline`
(start at `worker.server.ts` and `stages.server.ts`). Less is more: no GitHub Projects
sync, no webhooks, no per-task issues. Keep it that way unless asked.

This is a WebJs app: AI-first, web-components-first, buildless, and
progressively enhanced. Read this whole file before you edit anything, then
follow it. The steps here are required, not optional.

## Gather context BEFORE you build (required)

WebJs is its own framework. It is not React, Next, or Lit, so writing code from
that muscle memory produces broken WebJs code. Before you write or change
anything, gather context from these sources. Do not skip a step to save time.
This is what separates a working app from a broken one.

1. **Read the skill.** Start with `.agents/skills/webjs/SKILL.md`, then load the
   `references/*.md` files it routes to for the surface you are touching. The
   skill is the guide to building a WebJs app: it helps you choose the right
   layer, reach for the right export, and avoid the mistakes Next.js or Lit
   habits cause. Reading it is never wasted work: it survives the
   gallery-clearing step in the playbook below.
2. **Study the shipped examples, then build on a clean slate.** The template
   playbook below says what ships and the exact order to follow. The workflow
   rules (git, tests, review) are in `.agents/rules/workflow.md`; follow them
   too.
3. **Read the framework source for exact contracts.** WebJs is 100% buildless
   native ES modules, so the source you run IS the source you read. For one
   export's signature and doc comment run `bunx webjs source <Export>` (for
   example `bunx webjs source createAuth`); it reads the installed package and
   prints the declaration, not the file. When you need the behaviour behind a
   signature, open the package source under `node_modules/@webjsdev/*` directly
   (each package ships its own `AGENTS.md`). The full hosted docs are at
   https://webjs.dev/docs.

## Build a full-stack app (default template)

This scaffold ships a browsable feature gallery to learn from: single-concept
demos under `app/features/`, the `app/examples/todo` app, and an example design
system under `components/ui/`, with logic in `modules/`. Build in this order.

### 1. Study the gallery, then clear it

Read the demos under `app/features/` (and `app/examples/todo`) that match what
you are building, so you copy the real idiom: server actions, queries,
optimistic UI, component hydration, design tokens. Then run
`bun run gallery:clear` to shed the whole gallery and reset `app/page.ts` and
`app/layout.ts` to a blank slate. The clear also removes the example
`components/ui/` primitives, the demo `todos` table, and the demo migrations;
it keeps the agent skill, the database wiring, and `lib/utils/cn.ts` (needed by
`bunx webjsdev ui add`). The skill teaches the same patterns, so the gallery is
a runnable copy you study first, not something you lose.

### 2. Model the data

Define real models in `db/schema.server.ts`, then run `bun run db:generate` and
`bun run db:migrate` (required after the clear, which removed the demo table and
migrations). Write a seed script at `db/seed.server.ts` and run
`bun run db:seed` so list and detail pages render real rows while you build,
instead of empty states. Put reads in `modules/<feature>/queries/*.server.ts`
and writes in `modules/<feature>/actions/*.server.ts`, one function per file.

### 3. Build a token-based design system

Full reference: `.agents/skills/webjs/references/styling.md`.

- Define your color tokens as CSS custom properties in `app/layout.ts`, each
  written ONCE with the native CSS `light-dark(LIGHT, DARK)` function, so light
  and dark modes come from one declaration.
- Define at least: `--background`, `--foreground`, `--card`, `--primary`,
  `--secondary`, `--muted`, `--muted-foreground`, `--accent`, `--border`,
  `--ring`, `--destructive`. Add the matching `*-foreground` pair for each
  surface token you use, following the styling guide's reference palette.
- Consume colors ONLY as token utilities: `bg-background`, `text-foreground`,
  `bg-card`, `border-border`, `text-primary`, `text-muted-foreground`,
  `bg-destructive`.
- NEVER put a raw un-themed Tailwind color (`red-500`, `blue-600`, `gray-100`)
  on an element or a `@webjsdev/ui` helper.
- Add an inline theme-detection script in the layout `<head>` so the first
  paint matches the saved theme with no flash.

### 4. Use the UI kit, do not hand-roll primitives

Pull primitives with `bunx webjsdev ui add <name>`; the source is copied into
`components/ui/`, so you own it fully and can add, remove, restructure, or theme
it however your app needs. Do NOT guess a helper or tag signature. Inspect the
copied file `components/ui/<name>.ts`, or run
`bunx webjsdev ui view <name>`, for the exact exported names, variants, and
sizes. The kit has two tiers:

- **Tier 1, class helpers** for static primitives (button, card, input, badge,
  native-select, textarea). Spread the helper onto a native element, for example
  `class=${buttonClass({ variant: 'outline', size: 'sm' })}`.
- **Tier 2, custom elements** for stateful controls and overlays (`<ui-tabs>`,
  `<ui-dialog>`, `<ui-dropdown-menu>`, `<ui-tooltip>`, sonner toasts). Use the
  registered tag; it owns its ARIA, focus trap, and keyboard navigation out of
  the box. Never hand-author a tab strip or a modal when a Tier-2 element
  covers it.

Full reference: `.agents/skills/webjs/references/ui-kit.md`.

### 5. Build a multi-page app (MPA), not a single page

Structure the product as real routes, not one page that swaps client state:

- `/` a home or overview page.
- `/<resource>` a list page with search, filters, sorting, and a create form or
  modal.
- `/<resource>/[id]` a detail page for one item.
- a couple of additional feature pages as the product needs.

Give `app/layout.ts` a navbar that links the main pages, pinned with
`position: fixed` (never `position: sticky`, which flickers on iOS during a
client-router navigation), and reserve its height on the content with a
`--header-height` offset. In a list or table, clicking a row or card navigates
to that item's detail page. Wrap each row action button (edit, delete, status)
so its handler calls `event.stopPropagation()`, letting the button run its own
action without also triggering the row navigation.

### 6. Build components for interactivity

Pages and layouts never hydrate, so put every interactive behavior inside a
`WebComponent` custom element, and declare its reactive properties only in the
base-class factory (the skill's "Core WebJs Rules" 11). Use the shorthand for primitives
(`extends WebComponent({ name: String, count: Number, open: Boolean })`) and the
`prop<T>()` helper for typed objects and arrays
(`extends WebComponent({ items: prop<Item[]>(Array), user: prop<User>(Object) })`).

### 7. Verify before you call it done

Run `bun run ci` and fix what it reports. It runs every gate declared under
`webjs.ci` in `package.json` (`webjs check`, `webjs doctor`, `webjs typecheck`,
a dependency audit, then the server, browser, and e2e test layers for the
features you built), and the GitHub workflow runs the
same list; `.agents/rules/workflow.md` has what each gate checks. While
iterating, `bun run ci -- --only Tests` runs one layer. Then
`bun run css:build` (compile Tailwind).

Then boot `bun --bun run dev`, confirm every page route returns HTTP 200, and open
every route you changed in a real browser and play through its states: `check`
and `typecheck` pass even when a layout collapses, so the browser is the real
check for UI work.

### Commands

```sh
bun install
bun run gallery:clear        # shed the demo gallery before building a real app
bun --bun run dev                  # dev server at http://localhost:8080
bun --bun run start                # production server
bun run test                     # unit + browser tests
bun run typecheck
bun run css:build            # compile Tailwind
bun run ci                   # every gate, one command (the webjs.ci steps in package.json)
bun run check                # correctness checks
bun run doctor               # project health (severity per check: webjs.doctor.gate)
bunx webjsdev ui add <name>   # copy a ui primitive into components/ui/
bunx webjsdev ui view <name>  # inspect a primitive's exact signature
bun run db:generate && bun run db:migrate
```

## Type everything (all templates)

Derive the type at every boundary from its source. Never reach for `any`, and
never `unknown` where a real type exists. The rule is step 8 of the skill's "Default
Workflow"; the forms to reach for:

- A database row: `typeof table.$inferSelect` (`$inferInsert` for a write),
  carried into a shipping component with `import type`.
- An action's input: a named `interface`. Its result: `ActionResult<T>`.
- Routing files: `PageProps<'/blog/[slug]'>`, `LayoutProps`,
  `RouteHandlerContext`. `bunx webjsdev types` writes the typed `Route` union.
- A reactive property: `prop<Student>(Object)`, `prop<Tag[]>(Array)`.

The full ladder, with an end-to-end example, is
`.agents/skills/webjs/references/typescript.md`.

Keep server-only code (database drivers, secrets, `node:*` builtins) in
`.server.ts` modules. The two kinds (with and without `'use server'`) are the
skill's "Core WebJs Rules" 1 and 2.

## Data (all templates)

Use the wired-up database (Drizzle) for every piece of data the app stores;
the playbook above has the modeling step. Never store app data in a JSON file,
an in-memory array, or localStorage.
