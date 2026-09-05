# Mobile Workers and Projects Design

**Date:** 2026-09-01
**Status:** Revised after attention-dashboard review; awaiting written-spec review

## Goal

Make the mobile app's primary navigation and worker workflow more direct and Apple-native. Projects becomes the first sidebar destination and an orchestrator-first attention queue. Workers remains the cross-project operational screen, with native header controls, direct access to every worker, and session search.

## Navigation

The sidebar destination order is:

1. Projects
2. Workers
3. Orchestrator
4. Pull Requests

The existing compact session list remains below those destinations under the heading `Recent Workers`. It continues to show non-terminated sessions across all projects, with pinned sessions first and then newest activity. Settings remains a compact control anchored to the bottom-left of the sidebar.

Projects is listed first but does not silently change the app's launch destination; the existing Workers route remains the initial screen. Internal route names remain stable, and both the sidebar destination and page heading use `Workers`.

## Workers Screen

Workers always displays sessions across all projects. It no longer depends on the global active-project filter.

The three summary count cards and the project switcher are removed. The grouped worker list begins immediately below the header and retains the existing attention/status sections and collapsible archive.

The header contains:

- the title `Workers` and the connected host subtitle;
- a compact native menu button;
- a compact native notifications button with the unread badge.

On iOS, the menu and notifications controls use SwiftUI through `@expo/ui`, with interactive Liquid Glass styling. Android receives equivalent compact native controls through Expo UI rather than importing the iOS implementation.

A bottom dock contains a native search field on the left and a native add/spawn button on the right. The spawn control opens the existing spawn flow. Search is local and immediate, matching case-insensitively against session title, project name, branch, and visible status label. It searches both live and archived sessions; archived matches are displayed while a query is active so search results are not hidden behind the collapsed archive.

Pull-to-refresh and existing connection/error states remain unchanged. An empty search result uses concise search-specific copy and clearing the field restores the grouped board.

## Projects Attention Screen

Projects is an action-focused queue backed entirely by data the mobile store already receives. Its job is to answer `Which project needs me now, and why?`, not to repeat worker and pull-request counts in another dashboard.

The screen is divided into three sections:

1. `Needs Attention` contains projects with an orchestrator coverage problem, a worker or pull-request action, or stale live work.
2. `Quiet or Stale` contains projects without active progress and explains how long they have been quiet.
3. `On Track` contains healthy projects and is collapsed by default.

Every project appears exactly once, under its highest-priority signal. If lower-priority issues also exist, the card shows a compact `N more items` disclosure instead of duplicating the project.

Project order is dynamic but not noisy. Cards move when their attention tier changes. Within a tier, the oldest unresolved or inactive signal comes first, using the associated session's `lastActivityAt` where the API does not provide a distinct event timestamp. Routine worker activity must not constantly reshuffle cards that remain in the same tier.

The priority order is:

1. orchestrator missing or stopped;
2. worker waiting for a response;
3. failing or conflicting pull request, requested changes, or unresolved comments;
4. approved and mergeable pull request;
5. live worker with no activity for 24 hours;
6. project with no live workers;
7. otherwise on track.

Pull-to-refresh uses the existing store refresh operation. A project with no sessions still appears as quiet and offers a way to start coordinated work.

## Project Attention Card

Each project card shows:

- project name and severity;
- orchestrator state, always visible as `Watching`, `Needs attention`, `Stopped`, or `Not started`;
- one plain-language attention reason;
- the relevant worker, pull request, branch, or inactivity duration;
- a separate orchestrator coverage line showing that coordination is available;
- one primary orchestrator action;
- an optional secondary shortcut to the relevant worker or pull request;
- a compact count of additional attention items.

The primary action is always orchestrator-first:

- a running orchestrator uses `Open Orchestrator`;
- a missing orchestrator uses `Start Orchestrator`;
- a stopped orchestrator uses `Resume Orchestrator`;
- tapping the card itself performs the same primary action.

The secondary action may use `Open Worker` or `Open Pull Request` when a specific item caused the alert. It never replaces the orchestrator as the card's primary destination.

## Orchestrator Integration

Every project is expected to have visible orchestrator coverage. Missing and stopped orchestrators are therefore attention conditions rather than passive metadata.

Opening a running orchestrator from Projects navigates to the Orchestrator screen focused on that project. The screen must not drop the user into an undifferentiated all-project list. It receives a project ID, brings that project's orchestrator into focus, and exposes its workers and attention zones using the existing orchestrator data and actions.

Starting or resuming uses the existing orchestrator launch operation for that project. When launch succeeds, the app opens the resulting orchestrator session. Existing confirmation behavior for destructive restart remains unchanged; the Projects card does not add a restart shortcut.

The previously introduced project-summary/detail flow is replaced as the primary card destination. Projects does not need a separate metric-heavy project overview when the project-focused Orchestrator view already owns coordination context. Worker and pull-request shortcuts continue to use their existing detail behavior.

## Data and Boundaries

No daemon or API contract change is required. Project attention items are derived in a pure mobile view-model helper from `projects`, `sessions`, `orchestrators`, and the PR facts already stored on sessions. It reuses `attentionOf`, `orchestratorState`, and the existing PR presentation rules instead of duplicating them. This keeps ranking, copy, and actions testable.

The current data relates workers and orchestrators only through their shared project. It does not prove that an orchestrator spawned a worker or raised a specific alert. The UI therefore presents attention as derived project state and presents orchestrator coverage separately; it must not use copy such as `Raised by the orchestrator` without a future backend fact supporting that claim.

The Orchestrator screen receives an optional project ID and resolves current project/orchestrator data from the app store. Missing or stale project IDs render a recoverable state with navigation back to Projects or the all-project Orchestrator list.

Native UI is split by platform file:

- iOS implementations import `@expo/ui/swift-ui` and SwiftUI modifiers;
- the base implementation uses universal Expo UI controls and is safe on Android;
- unbounded worker and project collections remain React Native virtualized lists, as Expo UI's native trees are not used for unbounded dynamic lists.

## Accessibility and Interaction

Every icon-only control has an accessibility label and a minimum 44-point hit target. Search exposes a clear action and identifies itself as session search. Notification badges expose the unread count to assistive technology. Navigation and spawn actions retain existing haptic behavior.

The bottom dock accounts for the safe-area inset and adds list padding so it never obscures the final worker row or archive result.

## Testing

Pure tests cover:

- sidebar destination order and visible copy;
- cross-project session search fields and archived-result behavior;
- attention-tier classification and ordering;
- one-card-per-project behavior and additional-item counts;
- missing, stopped, and running orchestrator actions;
- worker and pull-request attention copy and secondary destinations;
- stale and quiet classification, including the 24-hour boundary;
- project-focused Orchestrator routing and missing-project recovery.

Component integration is verified through TypeScript compilation and iOS/Android Expo exports. The iOS development build is exercised in Simulator to confirm the SwiftUI controls render, the sidebar opens, search filters the list, and the spawn and notification routes remain reachable.

## Out of Scope

- Project creation, editing, archiving, or deletion.
- New backend endpoints, persisted project metrics, or persisted attention state.
- Replacing worker cards or redesigning session detail.
- Redesigning the generic all-project Orchestrator experience beyond adding project focus.
