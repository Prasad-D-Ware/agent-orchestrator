# Mobile Orchestrator Project Inbox Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mobile Orchestrator tab's metric cards with a compact, attention-ordered project inbox whose running rows open orchestrators and whose native actions start, resume, or restart them.

**Architecture:** A pure view model in `orchestratorView.ts` derives truthful row copy, section membership, and stable ordering from existing project, session, and orchestrator data. A focused row component renders the list treatment, while platform-split Expo UI controls own native Start/Resume and overflow-menu behavior; the route retains side effects, navigation, refresh, and error handling.

**Tech Stack:** Expo SDK 57, Expo Router, React Native `SectionList`, `@expo/ui` universal and SwiftUI components, TypeScript, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-04-mobile-orchestrator-project-inbox-design.md`

## Global Constraints

- Do not change the daemon, persistence, or API contract.
- Do not invent an orchestrator goal or conversation title; derive all visible copy from current project, orchestrator, worker, and PR facts.
- Relate workers to orchestrators only through shared `projectId`; never claim ownership or direct spawning.
- Use React Native `SectionList` for the unbounded project collection; Expo UI `List` is not virtualized.
- Tapping a running row opens `/session/[id]`; tapping a missing/stopped row background never launches runtime state.
- Preserve Start, Resume, Restart confirmation, chat-preflight fallback, classified connection errors, pull-to-refresh, loading, and empty states.
- Keep unrelated dirty-worktree changes untouched. Do not commit during execution unless the user explicitly asks.

---

### Task 1: Derive project inbox sections and truthful copy

**Files:**
- Modify: `packages/mobile/lib/orchestratorView.ts`
- Modify: `packages/mobile/lib/orchestratorView.test.ts`

**Interfaces:**
- Consumes: `ProjectInfo`, `DashboardSession`, and `OrchestratorLink` from `./api`; `attentionOf` and terminal/archive facts from existing view helpers.
- Produces:

```ts
export type OrchestratorProjectAction = "open" | "start" | "resume";
export type OrchestratorProjectSectionKey = "attention" | "coordinating" | "not-running";

export type OrchestratorProjectRow = {
  project: ProjectInfo;
  link: OrchestratorLink | null;
  workers: DashboardSession[];
  section: OrchestratorProjectSectionKey;
  action: OrchestratorProjectAction;
  headline: "Project needs attention" | "Orchestrator is active" | "Orchestrator stopped" | "No orchestrator yet";
  detail: string;
  activityAt: string | null;
  urgency: number;
};

export type OrchestratorProjectSection = {
  key: OrchestratorProjectSectionKey;
  title: "Needs Attention" | "Coordinating" | "Not Running";
  data: OrchestratorProjectRow[];
};

export function orchestratorProjectSections(
  projects: readonly ProjectInfo[],
  sessions: readonly DashboardSession[],
  orchestrators: readonly OrchestratorLink[],
): OrchestratorProjectSection[];
```

- [ ] **Step 1: Add failing section and action tests**

Add fixtures for three projects, running/stopped/missing links, and workers in `respond`, `review`, `merge`, and `working` zones. Assert:

```ts
const sections = orchestratorProjectSections(projects, sessions, orchestrators);
expect(sections.map((section) => section.title)).toEqual([
  "Needs Attention",
  "Coordinating",
  "Not Running",
]);
expect(sections.flatMap((section) => section.data).map((row) => row.project.id).sort()).toEqual([
  "attention",
  "coordinating",
  "missing",
  "stopped",
]);
expect(rowByProject(sections, "coordinating").action).toBe("open");
expect(rowByProject(sections, "missing").action).toBe("start");
expect(rowByProject(sections, "stopped").action).toBe("resume");
```

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `cd packages/mobile && npm test -- lib/orchestratorView.test.ts`  
Expected: FAIL because `orchestratorProjectSections` and exported row types do not exist.

- [ ] **Step 3: Implement classification and one-row-per-project mapping**

Build one row per project by locating its matching link, calling `workersOf`, excluding archived/terminated workers from active facts, and deriving:

```ts
const action = state === "running" ? "open" : state === "stopped" ? "resume" : "start";
const actionable = respond + actionCount + review + merge > 0;
const section = state !== "running" ? "not-running" : actionableStatus || actionable ? "attention" : "coordinating";
```

Treat orchestrator statuses `needs_input`, `changes_requested`, `stuck`, `errored`, and `ci_failed` as actionable. Assign explicit urgency values so orchestrator failure/input precedes worker response, review, and ready-to-merge facts.

- [ ] **Step 4: Add failing copy, pluralization, and ordering tests**

Assert exact copy rather than snapshots:

```ts
expect(row.detail).toBe("2 workers need input · 1 pull request is ready");
expect(single.detail).toBe("1 worker needs input");
expect(healthy.detail).toBe("Coordinating 3 active workers");
expect(missing.detail).toBe("Start one to coordinate work for this project");
```

Also assert higher urgency first, oldest unresolved activity first within attention, newest activity first elsewhere, original project order for equal timestamps, omitted empty sections, and no project duplication.

- [ ] **Step 5: Implement copy and stable sorting**

Use small pure helpers such as `plural`, `latestActivityAt`, `attentionActivityAt`, and `rowDetail`. Prefer actionable facts in this order: workers needing input, workers needing review, pull requests ready to merge, then active-worker count. Use `link.updatedAt` and worker `lastActivityAt` only as timestamps, never as invented narrative.

- [ ] **Step 6: Run focused tests and confirm GREEN**

Run: `cd packages/mobile && npm test -- lib/orchestratorView.test.ts`  
Expected: PASS, including all existing lifecycle, launch-intent, status, worker-matching, and zone-count tests.

- [ ] **Step 7: Review the focused diff**

Run: `git diff -- packages/mobile/lib/orchestratorView.ts packages/mobile/lib/orchestratorView.test.ts`  
Expected: only pure presentation derivation and its tests; no API or storage changes.

---

### Task 2: Add native bounded row actions

**Files:**
- Create: `packages/mobile/lib/orchestrator-row-actions.types.ts`
- Create: `packages/mobile/lib/orchestrator-row-actions.tsx`
- Create: `packages/mobile/lib/orchestrator-row-actions.ios.tsx`

**Interfaces:**
- Consumes: theme and color-scheme values from `ThemeProvider`; `@expo/ui` universal controls on the base platform and `@expo/ui/swift-ui` on iOS.
- Produces:

```ts
export type OrchestratorRowActionProps = {
  action: "start" | "resume";
  projectName: string;
  busy: boolean;
  onPress: () => void;
};

export function OrchestratorRowAction(props: OrchestratorRowActionProps): React.ReactElement;

export type OrchestratorRowMenuProps = {
  projectName: string;
  onRestart: () => void;
};

export function OrchestratorRowMenu(props: OrchestratorRowMenuProps): React.ReactElement;
```

- [ ] **Step 1: Define shared props without platform imports**

Create the types file exactly as above so both platform implementations expose the same contract and platform-specific SwiftUI symbols never enter Android bundles.

- [ ] **Step 2: Implement the universal Expo UI controls**

Wrap each bounded control in `Host`. Render Start/Resume as a compact button with a 44-point minimum container, disabled busy state, and `testID`. Render the running-row overflow as a `Menu` labeled `More actions for <projectName>` with a destructive `Restart orchestrator` item.

- [ ] **Step 3: Implement the iOS SwiftUI controls**

Use `Button`/`Menu` from `@expo/ui/swift-ui` with glass or borderless native styling, semantic tint, explicit accessibility labels/identifiers, and a fixed host frame. Keep the visible action copy to `Start` or `Resume`; use an ellipsis system image for the overflow menu.

- [ ] **Step 4: Typecheck platform resolution**

Run: `cd packages/mobile && npm run typecheck`  
Expected: PASS with no iOS-only view-config imports reachable from the base implementation.

- [ ] **Step 5: Review the focused diff**

Run: `git diff -- packages/mobile/lib/orchestrator-row-actions.types.ts packages/mobile/lib/orchestrator-row-actions.tsx packages/mobile/lib/orchestrator-row-actions.ios.tsx`  
Expected: only the bounded native action abstraction; no list or route logic.

---

### Task 3: Render the full-width project rows

**Files:**
- Create: `packages/mobile/lib/orchestrator-project-row.tsx`
- Modify: `packages/mobile/lib/orchestratorView.test.ts`

**Interfaces:**
- Consumes: `OrchestratorProjectRow`, `orchestratorStatus`, `relativeTime`, `OrchestratorRowAction`, and `OrchestratorRowMenu`.
- Produces:

```ts
export function OrchestratorProjectRowView(props: {
  row: OrchestratorProjectRow;
  busy: boolean;
  onOpen: (row: OrchestratorProjectRow) => void;
  onLaunch: (row: OrchestratorProjectRow) => void;
  onRestart: (row: OrchestratorProjectRow) => void;
}): React.ReactElement;
```

- [ ] **Step 1: Add failing presentation-label tests**

Add a pure exported helper if needed:

```ts
export function orchestratorRowAccessibilityLabel(
  projectName: string,
  statusLabel: string,
  action: OrchestratorProjectAction,
): string;
```

Assert `Open orchestrator for agent-orchestrator, Needs input`, `Start orchestrator for landing-page`, and `Resume orchestrator for meetyou`.

- [ ] **Step 2: Run the focused tests and confirm RED**

Run: `cd packages/mobile && npm test -- lib/orchestratorView.test.ts`  
Expected: FAIL because the accessibility-label helper does not exist.

- [ ] **Step 3: Implement the row and helper**

Use a full-width `Pressable` only when `row.action === "open"`; otherwise use a non-pressable `View` with the native Start/Resume action. Render the folder icon, project name, text status plus dot, deterministic headline, two-line detail, relative timestamp, and chevron. Place the running-row menu as a bounded trailing control without reducing the rest of the row's open target. Match `WorkerListRow` horizontal padding, separator, pressed background, and typography rhythm instead of using `cardShell`.

- [ ] **Step 4: Preserve accessibility and hit targets**

Set `accessibilityRole="button"`, the exact derived label, and a minimum 76-point row height. Ensure the native action and overflow hosts each reserve at least 44 by 44 points. Status remains visible as text so color is never the only signal.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `cd packages/mobile && npm test -- lib/orchestratorView.test.ts && npm run typecheck`  
Expected: PASS.

- [ ] **Step 6: Review the focused diff**

Run: `git diff -- packages/mobile/lib/orchestrator-project-row.tsx packages/mobile/lib/orchestratorView.ts packages/mobile/lib/orchestratorView.test.ts`  
Expected: row rendering stays outside the route and all copy/routing labels remain pure and tested.

---

### Task 4: Replace the Orchestrator route with the sectioned inbox

**Files:**
- Modify: `packages/mobile/app/(tabs)/orchestrator.tsx`

**Interfaces:**
- Consumes: `orchestratorProjectSections`, `OrchestratorProjectRowView`, app-store `projects`/`sessions`/`orchestrators`, `launchConductor`, Expo Router, and existing connection/chat error helpers.
- Produces: the final `Orchestrators` cross-project screen.

- [ ] **Step 1: Compute sections once from store data**

Add:

```ts
const sections = useMemo(
  () => orchestratorProjectSections(projects, sessions, orchestrators),
  [projects, sessions, orchestrators],
);
```

Track launch/restart busy state by project ID rather than one global boolean so unrelated rows remain usable.

- [ ] **Step 2: Replace ScrollView/card mapping with SectionList**

Render `ScreenHeader` with `title="Orchestrators"`, `subtitle="Projects, ordered by attention"`, and the existing connection lamp. Use `SectionList` with section headers, `keyExtractor={(row) => row.project.id}`, the focused row component, safe-area-aware bottom padding, separators owned by rows, and existing `RefreshControl` behavior.

- [ ] **Step 3: Wire whole-row open navigation**

For `open`, trigger `haptics.select()` and push:

```ts
router.push({
  pathname: "/session/[id]",
  params: { id: row.link!.id, projectId: row.project.id },
});
```

Never attach this callback to a missing/stopped row background.

- [ ] **Step 4: Wire Start and Resume**

Call `launchConductor(row.project.id, false, "chat")`. On success, open the returned session. Preserve `isChatPreflightError`, `chatErrorCopy`, Terminal UI fallback, classified connection errors, busy cleanup in `finally`, and an immediate `refresh()` when the launch/open target is stale.

- [ ] **Step 5: Preserve Restart in the native overflow menu**

The menu callback presents the existing `Restart orchestrator?` destructive confirmation. Confirmation calls `launchConductor(row.project.id, true, row.link?.mode ?? "chat")`; successful replacement opens the returned session. No restart icon remains permanently visible in the row.

- [ ] **Step 6: Preserve route states**

Keep the initial spinner, configured/no-server state, classified error with Retry, no-project state, pull-to-refresh, and bottom inset. Remove `ZONE_ORDER`, count pills, `cardShell`, and obsolete per-card nested actions.

- [ ] **Step 7: Run focused and full mobile verification**

Run:

```bash
cd packages/mobile
npm test -- lib/orchestratorView.test.ts
npm run typecheck
npm test
```

Expected: focused tests PASS, TypeScript PASS, full Vitest suite PASS.

- [ ] **Step 8: Check formatting and unintended edits**

Run:

```bash
git diff --check
git status --short
git diff -- packages/mobile/app/'(tabs)'/orchestrator.tsx packages/mobile/lib/orchestratorView.ts packages/mobile/lib/orchestratorView.test.ts packages/mobile/lib/orchestrator-project-row.tsx packages/mobile/lib/orchestrator-row-actions.types.ts packages/mobile/lib/orchestrator-row-actions.tsx packages/mobile/lib/orchestrator-row-actions.ios.tsx
```

Expected: no whitespace errors; only the planned Orchestrator files appear in the focused diff.

- [ ] **Step 9: Exercise the connected iPhone development build**

With Metro running on port 8081 and the existing development build connected, reload the app and verify:

1. Needs Attention, Coordinating, and Not Running sections omit themselves when empty.
2. A tap near every edge of a running row opens the correct orchestrator.
3. Start and Resume do not trigger from row-background taps and cannot double-submit while busy.
4. The overflow menu restarts only after destructive confirmation.
5. Pull-to-refresh, long project names, two-line detail, dynamic type, light/dark theme, and VoiceOver labels remain readable.

Expected: behavior matches the approved Option A mockup and no native sheet or control renders blank.
