# Mobile Haptics and Navigation Consistency

## Status

Approved direction: shared haptic helpers/components plus a complete audit of direct mobile press targets. This document is local-only and must not be committed.

## Goals

- Give every intentional mobile tap appropriate feedback, including disclosure rows.
- Preserve stronger semantic feedback already used for selection, warning, success, and error states.
- Use one icon-only minimal back control across the mobile app.
- Add haptics to chat header actions, including the three-dot menu and refresh.
- Correct the preview refresh icon using deterministic layout instead of repeated visual offsets.

## Haptic policy

- `tap`: navigation, ordinary buttons, icon buttons, links, list rows, retry/refresh actions, inline disclosures, sheet dismissal controls, and chat header actions.
- `select`: tabs, radio choices, theme/model/agent/project choices, filters, and other value-selection controls.
- `warning`: the point at which a destructive confirmation is raised or accepted, following existing behavior.
- `success`: completed actions where the app already confirms success, such as copying, pairing, spawning, and completed mutations.
- `error`: failed actions where the app already reports failure.
- Disabled controls never vibrate.
- Long-press copy areas vibrate only when the long-press action succeeds.
- Press-and-hold voice controls retain their specialized lifecycle and are not wrapped in a generic tap handler.

## Architecture

Add small shared interaction utilities rather than replacing React Native `Pressable` globally:

1. A reusable minimal back button owns the 44×44 hit target, icon-only appearance, fallback navigation behavior, and light haptic.
2. A small handler utility applies the selected haptic before invoking a synchronous or asynchronous press callback.
3. Existing higher-level controls in `lib/ui.tsx` remain the preferred path and keep their semantic feedback.
4. Direct `Pressable` call sites are audited and updated explicitly. This keeps special cases—disabled state, long press, microphone gestures, nested controls, destructive actions—visible at the call site.

## Navigation design

- All native stack detail screens use an icon-only back affordance; no `Back`, `Chat`, or `Settings` labels.
- The control has a minimum 44×44 target and uses the active theme foreground color.
- The terminal screen's custom labeled back control is replaced by the shared minimal control while preserving its custom leave/fallback logic.
- Modal close/cancel actions that are not conceptually navigation remain unchanged unless they are currently presented as a back button.
- Interactive-pop gestures remain native and do not add artificial feedback.

## Header action design

- Chat three-dot and refresh controls use light tap feedback.
- Preview refresh uses light tap feedback.
- The preview refresh glyph sits inside a fixed square inner alignment box centered by the 44×44 outer target. Any optical correction belongs to that inner box and is covered by a layout test.

## Audit scope

Audit all `Pressable`, `Touchable*`, shared `Button`, native stack header actions, and direct router-back call sites under:

- `packages/mobile/app/**`
- `packages/mobile/lib/**`

Each interactive target is classified as action, selection, disclosure, destructive, success/error lifecycle, long press, or gesture control. Existing correct haptics are preserved; silent targets receive the appropriate feedback.

## Testing

- Unit-test the shared haptic press policy without invoking native vibration APIs.
- Unit-test minimal back-button layout values and preview header alignment geometry.
- Add source-level audit tests for mobile header/back configuration and known direct press targets where practical.
- Run the complete mobile test suite and TypeScript typecheck.
- Verify on a real iOS device: back buttons, chat three-dot, chat refresh, disclosure rows, preview refresh centering, disabled controls, and microphone press-and-hold.

## Non-goals

- No backend or API changes.
- No change to navigation hierarchy, titles, routes, or native swipe-back gestures.
- No redesign of non-back action buttons.
- No haptic feedback for scrolling, typing, passive state changes, or automatic navigation.
