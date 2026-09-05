# Mobile Orchestrator Project Inbox Design

**Date:** 2026-09-04  
**Status:** Awaiting written-spec review

## Goal

Replace the mobile Orchestrator tab's number-heavy project cards with a compact, project-led orchestration inbox. The screen must answer three questions in order:

1. Which projects need the user's attention?
2. What is the orchestrator doing for each project?
3. How does the user open or start that orchestrator?

The resulting screen should share the Workers screen's header, section rhythm, typography, semantic status colors, and dense list treatment while remaining clearly project-oriented.

## Information Architecture

The page title becomes `Orchestrators`. A short subtitle says `Projects, ordered by attention`.

Every configured project appears exactly once in one of these sections:

1. `Needs Attention` — a live orchestrator needs input, is stuck, has errored, or the project's workers contain actionable `respond`, `action`, `review`, or `merge` attention.
2. `Coordinating` — the project has a running orchestrator and no actionable attention.
3. `Not Running` — the project's orchestrator is missing or stopped.

Sections with no projects are omitted. Within `Needs Attention`, higher urgency precedes lower urgency and older unresolved activity precedes newer activity. Within the other sections, the newest project activity comes first, with original project order as the stable final tie-breaker. Routine polling must not randomly reorder equal items.

The screen continues to ignore the Workers screen's active-project filter because it is the cross-project orchestration overview.

## Project Row

Each row shows:

- the project folder icon and project name;
- the orchestrator's derived status label and semantic status color;
- a short state headline;
- one plain-language supporting line derived from project worker and pull-request facts;
- the latest relevant activity time when available;
- a disclosure indicator for running orchestrators or a native action for missing/stopped orchestrators.

The UI must not invent an orchestrator goal or conversation name. The earlier mockup title `Mobile app revamp` was illustrative only. The current mobile orchestrator read model contains no durable goal, brief, summary, or conversation title.

Headlines are deterministic state copy:

- actionable project: `Project needs attention`;
- healthy running orchestrator: `Orchestrator is active`;
- stopped orchestrator: `Orchestrator stopped`;
- missing orchestrator: `No orchestrator yet`.

The supporting line uses the most useful available facts, preferring actionable facts over healthy counts. Examples include `2 workers need input · 1 pull request is ready`, `Coordinating 3 active workers`, and `Start one to coordinate work for this project`. Singular and plural forms must be correct. Copy must describe project-level derived state and must not claim that the orchestrator spawned or owns a worker, because the API only relates them through their shared project ID.

## Interaction

A row with a running orchestrator is one full-width press target. Tapping anywhere on it triggers selection haptics and opens `/session/[id]` for that orchestrator. The disclosure indicator is visual reinforcement, not a separate hit target.

A missing orchestrator displays an explicit native `Start` action. A stopped orchestrator displays an explicit native `Resume` action. Tapping the surrounding non-running row must not silently create or restore runtime state. Successful launch opens the returned orchestrator session. Existing chat-preflight fallback and human-readable connection errors remain unchanged.

Restart is removed as a permanently visible overview icon but preserved in a compact native overflow menu on each running row. Selecting Restart uses the existing destructive confirmation before replacing the orchestrator. The row itself continues to open the live orchestrator.

Worker attention text is informational on this page rather than a collection of independently tappable count pills. This prevents nested press targets from competing with the row's primary navigation behavior.

## Native UI and Layout

The unbounded project collection uses React Native `SectionList` rather than Expo UI `List`, because Expo UI's native list is not virtualized. The row remains a React Native press target so its full bounds navigate reliably.

Native-feeling controls use Expo UI where it provides the appropriate bounded control:

- the existing compact native menu and notification header controls are reused;
- Start and Resume use the project's platform-safe Expo UI button abstraction, with SwiftUI-backed treatment on iOS and the equivalent native treatment elsewhere;
- running-row overflow actions use Expo UI Menu, keeping Restart available without competing with the row's primary tap behavior;
- semantic colors, minimum 44-point hit targets, haptics, and accessibility labels follow existing mobile conventions.

Rows use subtle separators instead of elevated rounded dashboard shells. Content padding and type scale match the Workers list. Pull-to-refresh, safe-area handling, loading state, connection error state, and empty-project state remain available.

## Data and Component Boundaries

No daemon, storage, or API contract change is required.

`orchestratorView.ts` gains a pure project-inbox view model that receives `projects`, `sessions`, and `orchestrators` and returns sectioned row models. It owns:

- orchestrator/project matching;
- worker collection by shared project ID;
- attention classification and stable ordering;
- deterministic headline and supporting copy;
- relevant activity timestamp selection;
- row action state: `open`, `start`, or `resume`.

The route component owns only rendering, navigation, haptics, refresh state, launch side effects, confirmation/fallback alerts, and connection errors. A focused row component renders one accessible project row and receives explicit callbacks. This keeps classification and copy independently testable and prevents the route from regrowing presentation logic.

The existing `orchestratorState`, `orchestratorStatus`, `workersOf`, and shared attention/PR helpers are reused rather than reimplemented. Any obsolete count-pill UI and its screen-local ordering constant are removed once the new view model covers their behavior.

## Error and Transitional States

- Initial loading with no projects shows the existing centered activity indicator.
- Refresh keeps visible content in place and uses the existing pull-to-refresh control.
- A configured app with no projects shows `No projects` and the existing guidance to add a project in AO.
- Connection failures preserve the existing classified human-readable error and Retry action.
- A launch failure keeps the row visible and re-enables its action.
- A chat-preflight failure continues to offer the existing Terminal UI fallback.
- If an orchestrator disappears between render and tap, the route refreshes after the failed open/launch path rather than navigating to an invalid session.

## Accessibility

Running rows expose a single button label such as `Open orchestrator for agent-orchestrator, Needs input`. Start and Resume expose distinct labels and busy states. Status is communicated in text, not color alone. Dynamic type must not hide the project name or action; secondary copy may wrap to two lines. Row actions and header controls keep at least 44-point touch targets.

## Testing

Pure unit tests cover:

- every project appearing exactly once;
- the three section classifications;
- orchestrator status and worker/PR attention precedence;
- stable ordering and tie-breaking;
- missing, stopped, and running action states;
- truthful deterministic headline and supporting copy;
- singular/plural copy;
- activity timestamp selection;
- the constraint that workers are related only by project ID.

Component and route verification covers:

- tapping the full running row opens the orchestrator session;
- tapping a non-running row does not launch it;
- Start and Resume call the existing launch operation and open its result;
- the running-row overflow menu retains Restart and its destructive confirmation;
- busy controls prevent duplicate launches;
- chat fallback, classified errors, refresh, loading, and empty states remain functional;
- TypeScript compilation and the mobile test suite pass;
- the iOS development build renders and behaves correctly on the connected device, including native controls, full-row hit targets, dynamic type, and pull-to-refresh.

## Projects Navigation

This project inbox is the single Projects destination. It replaces the older project-summary tab and keeps the project list first in the sidebar. The route is `/projects`, the screen title is `Projects`, and its primary purpose remains showing coordinator coverage and opening or starting each project's orchestrator. Individual project detail routes remain available where the app links to them directly.

This design supersedes both the generic metric-heavy Orchestrator overview and the separate Projects-tab overview described or implied by the 2026-09-01 Workers and Projects design.

## Out of Scope

- Adding an orchestrator goal, generated title, or conversation summary to the backend.
- Persisting attention rank or display copy.
- Project creation, editing, deletion, or archiving.
- Redesigning the orchestrator session/chat screen.
- Redesigning the Workers tab.
- Adding another always-visible restart button to the overview list.
