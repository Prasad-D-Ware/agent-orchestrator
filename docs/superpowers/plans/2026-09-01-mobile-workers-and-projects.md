# Mobile Workers and Projects Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Projects overview and refine Workers with native controls, cross-project results, and search.

**Architecture:** Keep daemon contracts unchanged and derive project/search presentation in pure view-model helpers. Render unbounded data with React Native virtualized lists, while compact controls use platform files backed by SwiftUI on iOS and universal Expo UI elsewhere.

**Tech Stack:** Expo Router 57, React Native 0.86, TypeScript 6, `@expo/ui` 57, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-01-mobile-worker-sessions-and-projects-design.md`

## Global Constraints

- Projects is the first sidebar option; Workers remains the initial route.
- Visible destination and page copy stays `Workers`; the sidebar session section is `Recent Workers`.
- Workers displays sessions across all projects and removes count cards and the project switcher.
- iOS compact controls use `@expo/ui/swift-ui`; Android must never import that entry point.
- Unbounded collections use React Native `FlatList` or `SectionList`.
- No daemon or API contract changes.
- Do not create a worktree.

---

### Task 1: Worker Search View Model

**Files:**
- Create: `packages/mobile/lib/worker-search.ts`
- Create: `packages/mobile/lib/worker-search.test.ts`

**Interfaces:**
- Consumes: `DashboardSession`, project names, and `statusVisual(...).label` supplied by the caller.
- Produces: `filterWorkerSessions(sessions, query, projectNameFor, statusLabelFor): DashboardSession[]`.

- [ ] **Step 1: Write failing search tests**

Cover blank-query identity, case-insensitive title, project, branch, and status matching, plus archived sessions remaining eligible.

```ts
expect(filterWorkerSessions(sessions, "mobile", projectNameFor, statusLabelFor).map((s) => s.id)).toEqual(["mobile-audit"]);
expect(filterWorkerSessions(sessions, "terminated", projectNameFor, statusLabelFor).map((s) => s.id)).toEqual(["archived"]);
```

- [ ] **Step 2: Verify red**

Run: `cd packages/mobile && npm test -- --run lib/worker-search.test.ts`

Expected: FAIL because `filterWorkerSessions` does not exist.

- [ ] **Step 3: Implement normalized matching**

Build one lowercase haystack from `sessionTitle(session)`, project name, branch, and status label. Trim the query and return a copied array unchanged when it is empty.

- [ ] **Step 4: Verify green**

Run: `cd packages/mobile && npm test -- --run lib/worker-search.test.ts`

Expected: all worker-search tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/lib/worker-search.ts packages/mobile/lib/worker-search.test.ts
git commit -m "feat(mobile): add worker session search model"
```

### Task 2: Native Header and Worker Dock Controls

**Files:**
- Create: `packages/mobile/lib/native-header-button.ios.tsx`
- Create: `packages/mobile/lib/native-header-button.tsx`
- Create: `packages/mobile/lib/worker-dock.ios.tsx`
- Create: `packages/mobile/lib/worker-dock.tsx`
- Modify: `packages/mobile/lib/ui.tsx`

**Interfaces:**
- Produces: `NativeHeaderButton({ icon: "menu" | "bell", label, onPress })`.
- Produces: `WorkerDock({ query, onQueryChange, onSpawn })`.

- [ ] **Step 1: Inspect installed Expo UI signatures**

Run the Expo UI component listing script and inspect the installed SwiftUI `Button`, `TextField`, `Image`, and modifier declarations. Use only signatures present in `packages/mobile/node_modules/@expo/ui`.

- [ ] **Step 2: Implement the platform-safe header control**

The iOS file uses a 44-point SwiftUI button, SF Symbols (`line.3.horizontal` and `bell`), `glassEffect({ glass: { variant: "regular", interactive: true }, shape: "circle" })`, and accessibility modifiers. The base file uses universal Expo UI with the same hit target. Keep the unread badge in the React Native wrapper so its count semantics remain shared.

- [ ] **Step 3: Route existing header controls through it**

Update `HeaderIconButton` and `ScreenHeader` without changing their public props. This makes the menu native on every screen and the Workers notification action native without duplicating header layout.

- [ ] **Step 4: Implement the worker dock**

The iOS file uses SwiftUI `TextField` plus a circular glass `Button` with `plus`; the base file uses universal Expo UI. Both expose controlled search text, a clear affordance, `Search workers` accessibility copy, and a 52-point spawn target.

- [ ] **Step 5: Verify compilation**

Run: `cd packages/mobile && npm run typecheck`

Expected: exit 0 with platform resolution keeping SwiftUI imports out of Android.

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/lib/native-header-button* packages/mobile/lib/worker-dock* packages/mobile/lib/ui.tsx
git commit -m "feat(mobile): use native worker controls"
```

### Task 3: Refine the Workers Screen

**Files:**
- Modify: `packages/mobile/app/(tabs)/index.tsx`
- Modify: `packages/mobile/lib/sidebar-navigation-shell.tsx`
- Modify: `packages/mobile/lib/sidebar-navigation.ts`
- Modify: `packages/mobile/lib/sidebar-navigation.test.ts`

**Interfaces:**
- Consumes: `filterWorkerSessions(...)` and `WorkerDock`.
- Produces: cross-project Workers board with search and approved sidebar copy/order.

- [ ] **Step 1: Extend sidebar tests and verify red**

Assert the destination order begins Projects then Workers, and the recent-list heading copy is exported as `Recent Workers` for a single source of truth.

Run: `cd packages/mobile && npm test -- --run lib/sidebar-navigation.test.ts`

Expected: FAIL until Projects and the new copy exist.

- [ ] **Step 2: Make Workers cross-project**

Read `sessions` and `projects` directly from `useApp()` instead of `useVisibleSessions()`. Remove the count calculation, count-card jump handlers, `Stat`, and `ProjectSwitcher`.

- [ ] **Step 3: Integrate search**

Filter before `groupSessions`. When a non-empty query exists, include matching archived sessions in a visible `Search results` section rather than hiding them behind Archive. Preserve the normal grouped board and collapsible archive for an empty query.

- [ ] **Step 4: Add the bottom dock**

Render `WorkerDock` above the safe area, add sufficient list bottom padding, and keep the existing `/spawn` route and haptics. Replace the old React Native FAB.

- [ ] **Step 5: Update sidebar navigation**

Add `{ id: "projects", label: "Projects", icon: "folder", href: "/projects" }` first, keep `{ id: "agents", label: "Workers", href: "/" }` second, and change the session heading to `Recent Workers`. Increase the native navigation block height for four rows.

- [ ] **Step 6: Verify Workers and sidebar tests**

Run: `cd packages/mobile && npm test -- --run lib/worker-search.test.ts lib/sidebar-navigation.test.ts lib/agentsView.test.ts`

Expected: all selected tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/mobile/app/'(tabs)'/index.tsx packages/mobile/lib/sidebar-navigation* packages/mobile/lib/worker-*
git commit -m "feat(mobile): streamline the workers board"
```

### Task 4: Project Portfolio View Model

**Files:**
- Create: `packages/mobile/lib/projects-view.ts`
- Create: `packages/mobile/lib/projects-view.test.ts`

**Interfaces:**
- Produces: `ProjectSummary` with `project`, `activeWorkers`, `needsAttention`, `openPRs`, `failingPRs`, and `lastActivityAt`.
- Produces: `projectSummaries(projects, sessions): ProjectSummary[]` and `projectWorkers(projectId, sessions): DashboardSession[]`.

- [ ] **Step 1: Write failing aggregation tests**

Use complete `ProjectInfo` and `DashboardSession` fixtures. Assert terminated workers are excluded from active counts, attention counts use `attentionOf`, PRs are de-duplicated through `collectPRs`, failing CI is counted, empty projects remain, active projects sort before inactive ones, and per-project workers sort pinned then newest.

- [ ] **Step 2: Verify red**

Run: `cd packages/mobile && npm test -- --run lib/projects-view.test.ts`

Expected: FAIL because the view model does not exist.

- [ ] **Step 3: Implement pure aggregation**

Reuse `isArchived`, `attentionOf`, and `collectPRs`; do not duplicate their rules. Use stable project order as the final sort tie-breaker.

- [ ] **Step 4: Verify green**

Run: `cd packages/mobile && npm test -- --run lib/projects-view.test.ts`

Expected: all project view-model tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/lib/projects-view.ts packages/mobile/lib/projects-view.test.ts
git commit -m "feat(mobile): derive project portfolio summaries"
```

### Task 5: Projects and Project Overview Screens

**Files:**
- Create: `packages/mobile/app/(tabs)/projects.tsx`
- Create: `packages/mobile/app/project/[id].tsx`
- Create: `packages/mobile/lib/ProjectSummaryCard.tsx`
- Modify: `packages/mobile/app/_layout.tsx`
- Modify: `packages/mobile/app/spawn.tsx` only if its existing `projectId` route parameter is not already honored.

**Interfaces:**
- Consumes: `projectSummaries(...)`, `projectWorkers(...)`, `SessionCard`, `PRCard`, and existing `/spawn` and `/session/[id]` routes.
- Produces: `/projects` portfolio and `/project/[id]` overview routes.

- [ ] **Step 1: Build the project summary card**

Render the project name, active/attention counts, open PR count, failing-check indicator, and relative latest activity. The entire card opens `/project/[id]` and has a complete accessibility label.

- [ ] **Step 2: Build the Projects screen**

Use `FlatList`, `ScreenHeader`, the existing refresh operation, connection-aware empty/error states, and summaries derived from the full store. Do not add project management actions.

- [ ] **Step 3: Build the project overview route**

Resolve the route's `id` from the current store. Render `Project not found` with a back action when absent. Otherwise show compact summary metrics, active `SessionCard` rows, project PR cards, and a native spawn action linking to `/spawn?projectId=<id>`.

- [ ] **Step 4: Register the detail route**

Add `/project/[id]` to the root stack with the same native screen behavior used by session detail. Verify the existing spawn screen reads its `projectId` route parameter; add that read only if missing.

- [ ] **Step 5: Verify navigation and compilation**

Run: `cd packages/mobile && npm run typecheck`

Expected: exit 0.

Run: `cd packages/mobile && npm test`

Expected: every mobile test passes.

- [ ] **Step 6: Commit**

```bash
git add packages/mobile/app/'(tabs)'/projects.tsx packages/mobile/app/project packages/mobile/lib/ProjectSummaryCard.tsx packages/mobile/app/_layout.tsx packages/mobile/app/spawn.tsx
git commit -m "feat(mobile): add project portfolio views"
```

### Task 6: Platform and Simulator Verification

**Files:**
- Modify only files required by issues found during verification.

**Interfaces:**
- Consumes the complete feature.
- Produces verified iOS and Android bundles plus a live Simulator preview.

- [ ] **Step 1: Run final static verification**

Run: `cd packages/mobile && npm run typecheck && npm test`

Expected: TypeScript exits 0 and all tests pass.

- [ ] **Step 2: Export both platforms**

Run iOS and Android `expo export` commands into separate `/private/tmp` directories.

Expected: both Metro bundles complete without platform-import errors.

- [ ] **Step 3: Verify iOS interaction**

Reload the existing iOS development build. Confirm menu and notification glass controls render, search filters active and archived workers, the native spawn button opens `/spawn`, Projects is first in the sidebar, Projects cards open their overview, and project overview spawn preselects the project.

- [ ] **Step 4: Capture the result**

Capture Simulator screenshots of Workers, the open sidebar, Projects, and one project overview for the handoff.

- [ ] **Step 5: Final diff check**

Run: `git diff --check`

Expected: no whitespace errors.
