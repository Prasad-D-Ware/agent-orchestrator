# Mobile New-Agent Parity and Native Chat Sheets

Date: 2026-08-09

## Goal

Make AO Mobile's new-agent flow match the desktop New Task behavior for agent/model selection and optional task entry, center the Preview reload glyph in its native header control, and give every Chat selection sheet the same native presentation used by the Project and Theme pickers.

## Scope

This change covers three mobile surfaces:

1. The `New agent` modal in `packages/mobile/app/spawn.tsx`.
2. The Preview screen header in `packages/mobile/app/preview/[id].tsx`.
3. Sheet-like selection surfaces opened from Chat: Turn settings, Conversation map, Skills search, and Worktree files search.

The centered three-dot conversation action menu remains a popover. It is an action menu rather than a selection sheet and should not adopt bottom-sheet behavior.

## New-Agent Flow

### Selection rows

The settings group at the top of the screen contains three rows in this order:

1. Project
2. Agent
3. Model

Project and Agent keep their existing native `formSheet` pickers. Model opens a new native `formSheet` picker registered alongside those routes.

The Model row is disabled until both a project and agent are available. While its catalog is loading it reads `Loading…`. Otherwise it shows the resolved model label or `Auto` when the agent chooses its own model.

### Model discovery and defaults

Model discovery uses `GET /api/v1/agents/{agent}/models?projectId={projectId}`. The mobile response type mirrors the daemon's `AgentModelsResponse`, including:

- `selectionMode`: `catalog`, `text`, or `mode`;
- model identifiers, labels, and `isDefault`;
- `allowCustom`;
- stale/refresh metadata and warnings.

The initial selection mirrors desktop:

1. Use the selected project's configured worker model when the selected agent is the project worker default.
2. Otherwise use the selected agent catalog's default model or mode.
3. If neither exists, display `Auto` and send no override.

Changing Project or Agent resets any user-touched model from the previous pairing, then resolves the new pairing's default. A model explicitly selected by the user is sent only when it differs from the resolved default. This avoids turning an inferred default into a permanent override.

Catalog pickers show the available models plus the automatic/default choice. Mode-based agents show their modes through the same picker treatment. Text-based agents and catalogs that allow custom values expose a text entry inside the native sheet. Refresh and warning behavior follow the desktop model picker semantics.

### Task and creation behavior

The Name field and its hint are removed. The remaining prompt is labeled `TASK (OPTIONAL)` and uses the desktop placeholder `Describe the task (optional)…`.

An empty or whitespace-only task is valid. Project and Agent remain required. The launch button remains available with an empty task once the required selections exist.

Creation uses `POST /api/v1/orchestrators/delegate`, matching the desktop New Task flow, because that boundary accepts both the selected agent and model. The request contains:

- `projectId`;
- `brief`, including an empty string when no task is supplied;
- the resolved selected agent;
- `model` only for a user-selected override;
- `mode`, explicitly set to the selected mobile interface (`"chat"` or `"tui"`) so Chat remains the mobile default independently of the daemon's desktop preference.

The response's `workerId` is used to open the created session. The mobile store refreshes its session list and resolves the created session before navigation. Existing Chat preflight errors continue to offer Terminal UI as a fallback without clearing the user's task or selections.

The mobile-only Chat/Terminal UI selector remains. Chat remains the default, and changing interface continues to constrain the available Agent list.

## Preview Header Alignment

The Preview reload action receives an explicit square press target with `alignItems: "center"` and `justifyContent: "center"`. The Feather glyph stays at its current visual size, while the press target fills the native header action area so the icon is optically centered inside the circular navigation control.

The refresh behavior, accessibility label, and loading behavior do not change.

## Native Chat Sheets

### Presentation system

Turn settings, Conversation map, Skills search, and Worktree files search move from hand-built React Native `Modal` sheets to Expo Router stack routes with:

```tsx
presentation: "formSheet"
sheetGrabberVisible: true
sheetCornerRadius: 20
headerShown: false
```

This is the same system used by Project and Theme. On iOS it is backed by `react-native-screens` and UIKit's native sheet presentation, providing native drag-to-dismiss, rubber-banding, corner treatment, and detent transitions.

All routes use the shared `SheetHeader`, `SheetScreen`, and `SHEET_SCROLL_CONTENT` primitives where appropriate. Their surfaces, spacing, typography, selected-state color, row height, checkmarks, and pressed behavior match Project and Theme rather than retaining bespoke Chat sheet chrome.

### Detents and keyboard behavior

- Turn settings: scrolling detents `[0.5, 0.95]`.
- Conversation map: scrolling detents `[0.5, 0.95]`.
- Skills and Worktree files: keyboard-aware detents. iOS may size naturally around the keyboard; Android receives at least two detents so `react-native-screens` can expand the sheet when the IME appears.

### Data and results

Native routes cannot receive callbacks or complex in-memory Chat data as React props. A typed, short-lived sheet registry stores each sheet's input data and result/action callbacks under an opaque route key. It follows the existing `sheetResult` lifecycle:

- the opener parks the payload and callbacks;
- the route receives only the opaque key;
- the route reads the parked entry;
- the entry is released on selection, explicit close, swipe dismissal, or unmount.

No sheet payload is persisted. No conversation or daemon state moves into the router.

Turn settings keeps local optimistic selection state so several options can be changed without dismissing the sheet. It reports mutations through the parked callbacks and shows mutation errors within the native sheet.

Conversation map, Skills, and Worktree files dismiss after a selection and then report the selected sequence or insertion value to the Chat surface. Swipe dismissal returns no result.

### Preserved behavior

The conversion preserves:

- disabled settings while the controller is stopped or a mutation is pending;
- provider-driven config options and standard model/reasoning/approval controls;
- model-reroute and error notices;
- grouped provider choices and boolean switches;
- Conversation map markers and jump behavior;
- Skills and Worktree file filtering, badges, truncation notice, and text insertion;
- accessibility roles, selected/disabled state, labels, and haptics.

## Error Handling

- A model catalog failure leaves the Model row available with a clear warning and an automatic/custom fallback when the selected agent supports text input.
- A failed delegation keeps the modal open and preserves Project, Agent, Model, Interface, and Task state.
- A missing or expired parked sheet entry renders a quiet unavailable state and allows native dismissal instead of throwing.
- Sheet mutation errors remain visible until the next successful change or dismissal.

## Testing

Automated coverage includes:

- model default resolution for project defaults, catalog defaults, and automatic fallback;
- clearing a stale model when Project or Agent changes;
- catalog, mode, text, and custom model selection behavior;
- empty-task delegation payloads with no name/issue identifier;
- explicit model overrides and explicit Terminal UI mode;
- typed sheet registry lookup and cleanup after selection and dismissal;
- Preview header action style exposing a centered square target through a small testable helper or component;
- existing mobile unit tests and TypeScript compilation.

Manual verification on the running development client covers:

1. New agent with default and explicitly selected models.
2. New agent with an empty task.
3. Agent changes that replace the visible model default.
4. Preview reload alignment and press behavior.
5. Native presentation, detents, swipe dismissal, scrolling, selection, and keyboard behavior for every converted Chat sheet on iOS.

No native rebuild is required for ordinary React/TypeScript changes while Metro and the development client are running. If adding stack route files is not discovered by the current router manifest through Fast Refresh, restarting Metro or the development client is sufficient; native dependencies and configuration remain unchanged.

## Out of Scope

- Redesigning the three-dot action popover.
- Changing daemon lifecycle, controller, model-catalog, or LAN authentication behavior.
- Adding attachments to the mobile new-agent flow.
- Persisting recent/custom model choices beyond the daemon and desktop behavior already exposed.
- Restyling unrelated mobile modals that are not selection sheets opened from Chat.
