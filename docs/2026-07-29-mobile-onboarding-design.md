# Mobile first-run onboarding: design

**Date:** 2026-07-29
**Revised:** 2026-07-29 (v2 — reference-app shape: welcome screen + scanner, manual entry in a bottom sheet)
**Surface:** `packages/mobile` (Expo Router + React Native)
**Status:** Design, awaiting review

## Problem

A brand-new user's first launch is an empty Kanban tab whose empty state offers
"Configure server" (`app/(tabs)/index.tsx:67-79`), which drops them into a raw
five-field form (`app/(tabs)/settings.tsx:155-191`). There is no onboarding: a
repo-wide grep for `onboard|firstRun|welcome` returns nothing.

Three defects make that first run fail even when the user does everything right.

### 1. The default port cannot work

`lib/config.ts:19` ships `httpPort: "3001"`, and the type comment on `:11`
reinforces it. Verified against the backend:

- `backend/internal/config/config.go:27` sets `DefaultPort = 3001`, the
  loopback-only daemon for desktop and CLI. A phone can never reach it.
- `backend/internal/mobilebridge/config.go:20` sets `DefaultPort = 3011`, the
  opt-in LAN bridge the phone talks to.

The pairing QR carries the port (`lib/pairing.ts` reads `host`, `port`,
`password`), so scanning is unaffected. The wrong default only breaks manual
entry, which is the path the simulator and Tailscale users take.

### 2. A scan is never verified

`app/pair.tsx:37-44` does `saveConfig` then `reloadConfig()` then
`router.back()` unconditionally. It never checks that the scanned credentials
work. Scanning while Connect Mobile is off, or on the wrong Wi-Fi, returns the
user to a form that looks correct, with a 6px "offline" dot as the only signal.

### 3. The push prompt fires unframed

`lib/PushManager.tsx:52-62` calls `registerForPush` as soon as
`connection === "open"`, and `lib/push.ts:161-164` calls
`requestPermissionsAsync()` inside it whenever permission is undetermined. Note
`push.ts` does correctly gate on `canAskAgain`; the defect is the timing, not the
permission handling. The one-shot OS dialog therefore lands milliseconds after
the first successful connect, while the user is still reading the connection
result, with nothing having explained the value.

## Non-goals

- No structured chat UI. Out of scope and blocked on backend work regardless.
- No mDNS/Bonjour discovery. Tracked separately as the intended successor to
  QR pairing; this design must not block it.
- No paste-a-pairing-code path. The reference app offers one; ours would need a
  desktop "copy code" button that does not exist. Manual entry covers the same
  need. Revisit if the desktop button ships.
- No `expo-splash-screen`. A one-frame flash of the Kanban empty state on cold
  start is accepted rather than adding a dependency to suppress it.
- No `muxPort` / "TERMINAL PORT" field in the onboarding flow. It is legacy and
  unused (`lib/config.ts:11-12`, `:85-89`); it stays in Settings and out of the
  manual-connect sheet. This design does not remove it.
- No new animation or gesture library. The bottom sheet is built from the
  `Modal` primitive already used in `app/spawn.tsx:204` and
  `app/(tabs)/settings.tsx:249`.

## Design: welcome screen, then scanner

Two routes, matching the reference app.

> **Revision note.** v1 of this design argued for a single camera-first route
> ("the scanner is the page") on the grounds that any button before the scan is
> pure cost. That is superseded by explicit direction to follow the reference
> app. The cost is real and acknowledged: pairing is now two taps, not one. What
> it buys is a screen that explains what pairing *is* before asking for the
> camera, a stable place for "how it works" that survives a failed scan, and a
> home for the app's identity on first launch. The camera-permission prompt is
> still framed — the scanner route renders its three steps above the viewfinder
> before the OS dialog appears.

### Screen 1 — `/onboarding` (welcome)

```
  [logo]  AO                                Skip

              Connect your desktop

       Pair with AO on your computer to check
       on your agents, jump into any terminal,
          and drive work from your phone.

            +---------------------+
            |  [qr]  Pair Desktop |
            +---------------------+


  HOW IT WORKS

  (1)  Open AO on your computer
       Go to Settings -> Connect Mobile and turn it on.
  ---------------------------------------------------
  (2)  Scan the code
       Tap Pair Desktop above and point at the QR code
       on your screen.
  ---------------------------------------------------
  (3)  You're connected
       Your sessions appear here, and you can drive
       them from your phone.
```

- Title and body centered in the upper-middle; the "how it works" block is
  anchored to the bottom, as in the reference.
- One high-contrast filled primary button. Everything else on the screen is
  text.
- Numbered steps are hairline-separated rows: a rounded-square numeral badge, a
  bold title, a secondary-color subtitle.
- The reference puts a settings gear top-right. We use a text **Skip** instead: a
  gear here would navigate into Settings and the gate would bounce the user
  straight back. Skip sets the dismissal flag, which is the behavior actually
  wanted.

### Screen 2 — `/pair` (scanner)

```
  <

   (1)  Open AO on your computer
   (2)  Go to Settings -> Connect Mobile
   (3)  Scan the QR code

   +-------------------------------+
   | |                           | |
   |                               |
   |        [ live camera ]        |
   |                               |
   | |                           | |
   +-------------------------------+

        [clip]  Enter details manually
```

- Steps are compact single-line rows above the viewfinder — no subtitles, since
  screen 1 already carried them.
- The viewfinder is a rounded rect with **four corner brackets**, not the
  current full 240x240 bordered square (`app/pair.tsx:107-115`). Brackets read as
  a target; a closed box reads as a frame the code must fill exactly.
- Errors render between the viewfinder and the footer, in place. The user never
  leaves this route on a failed scan.
- This route is reached both from `/onboarding` and from the existing Settings
  "Scan QR" button (`app/(tabs)/settings.tsx:193-199`), so it must work with and
  without an onboarding context. It reads that from the router params rather
  than from the gate.

### Manual entry — a bottom sheet

The footer opens a sheet sliding up from the bottom over the scanner. It carries
the fields already in Settings, minus the legacy one:

```
  ==============================
        Connect manually
   Enter your computer's address
   from AO -> Settings -> Connect Mobile.

   HOST      [ 192.168.x.x            ]
   API PORT  [ 3011                   ]
   PASSWORD  [ ....................   ]

   Use TLS (https / wss)         ( o)

   +--------------------------+
   |      Connect             |
   +--------------------------+
  ==============================
```

- Fields: `host`, `httpPort`, `password`, `secure`. **Not** `muxPort` — see
  non-goals.
- One action, "Connect", which does `saveConfig` then `pingServer` then reports
  in place. It replaces the current three-button pile ("Scan QR", "Test
  connection", "Save & connect") — during onboarding there is no reason to
  separate testing from saving.
- The camera keeps running behind the sheet. Dismissing it by swipe or backdrop
  tap returns to a live scanner with no state lost.
- Settings keeps its existing inline form unchanged. The sheet is a second,
  onboarding-shaped presentation of the same config, not a replacement.

## Copy

### Mobile — welcome

| Element | Copy |
| --- | --- |
| Title | `Connect your desktop` |
| Body | `Pair with AO on your computer to check on your agents, jump into any terminal, and drive work from your phone.` |
| Primary button | `Pair Desktop` |
| Dismiss | `Skip` |
| Section header | `HOW IT WORKS` |
| Step 1 | `Open AO on your computer` / `Go to Settings → Connect Mobile and turn it on.` |
| Step 2 | `Scan the code` / `Tap Pair Desktop above and point at the QR code on your screen.` |
| Step 3 | `You're connected` / `Your sessions appear here, and you can drive them from your phone.` |

Step 3 deliberately does **not** copy the reference's "Everything is encrypted
end-to-end." The LAN bridge is plain HTTP unless the user turns on TLS
(`lib/config.ts:81-89`, `secure` defaults false), so that sentence would be
false for the default path.

### Mobile — scanner

| Element | Copy |
| --- | --- |
| Step 1 | `Open AO on your computer` |
| Step 2 | `Go to Settings → Connect Mobile` |
| Step 3 | `Scan the QR code` |
| Footer | `Enter details manually` |

### Mobile — manual sheet

| Element | Copy |
| --- | --- |
| Title | `Connect manually` |
| Subtitle | `Enter your computer's address from AO → Settings → Connect Mobile.` |
| Action | `Connect` |

### Failure copy

Keyed on the actual cause rather than the HTTP string:

| Cause | Copy |
| --- | --- |
| Not an AO QR | `That QR code isn't an AO pairing code.` |
| Reached nothing | `Scanned {host}:{port} but couldn't reach it. Is Connect Mobile still on, and is your phone on the same Wi-Fi?` |
| 401 | `That password was rotated. Re-scan the code on your computer.` |
| 429 | `Locked out after 5 failed attempts. Wait a minute, or toggle Connect Mobile off and on.` |
| iOS, private-range host, network error | Append: `If you denied the Local Network prompt, enable it in Settings > Privacy & Security > Local Network > AO.` plus a button calling `Linking.openSettings()`. |

### Desktop copy

`frontend/src/renderer/components/settings/ConnectMobileSetup.tsx:45` ships:

> Open Agent Orchestrator on your phone and tap Scan.

With a named primary button on the welcome screen this becomes accurate again
once retargeted:

> Open Agent Orchestrator on your phone and tap Pair Desktop.

(v1 of this design had to delete the clause entirely, since it had no button to
point at. The welcome screen makes the desktop copy *more* precise, not less.)
`ConnectMobileSetup.test.tsx` asserts only on the "same Wi-Fi as this computer"
line (`:8`), so no test change is required.

The desktop already covers "same Wi-Fi" (`:44`) and the Tailscale path (`:52`),
so the mobile copy deliberately does not restate them.

## Gate

Derived state plus a dismissal flag.

- Auto-shows when `!isConfigured(cfg) && !skipped`.
- "Skip" persists `ao.onboardingSkipped` to AsyncStorage.
- Successful pairing clears the flag.
- The Kanban empty state keeps a re-entry button, retargeted from `/settings` to
  `/onboarding` and relabeled from "Configure server" to "Connect your desktop".

`shouldOnboard({configured, skipped})` is a pure function so it is unit-testable
without a React Native test harness.

## Push

Cut from onboarding. The prompt moves to the first moment its value is
self-evident: the first time a session reaches `needs_input`, surfaced as a
dismissible inline card on the Kanban screen.

The signature change is still required and is independently correct:

```
registerForPush(cfg, { ask: boolean })
```

- Automatic callers (post-connect in `PushManager.tsx`, foreground refresh) pass
  `ask: false` and register only if permission is already granted.
- User-initiated callers (the deferred card, the existing Settings row) pass
  `ask: true`.

This removes the unframed prompt at connect time without changing what happens
for users who have already granted permission.

## File plan

| File | Status | Responsibility |
| --- | --- | --- |
| `packages/mobile/lib/onboarding.ts` | Create | Pure `shouldOnboard()` plus `ao.onboardingSkipped` helpers. No RN imports, mirroring `lib/pushStatus.ts`. |
| `packages/mobile/lib/onboarding.test.ts` | Create | Vitest, alongside `lib/pushStatus.test.ts`. |
| `packages/mobile/lib/connectionError.ts` | Create | Pure `describeConnectionFailure(err, cfg)` mapping cause to the copy table. Modeled on `describeRegisterFailure` (`lib/pushStatus.ts:146-208`). |
| `packages/mobile/lib/connectionError.test.ts` | Create | Vitest. |
| `packages/mobile/lib/OnboardingGate.tsx` | Create | Headless. Mounted beside `PushManager` in `app/_layout.tsx`. `router.replace("/onboarding")` once config resolves. |
| `packages/mobile/app/onboarding.tsx` | Create | Welcome screen. `headerShown: false`. |
| `packages/mobile/lib/ManualConnectSheet.tsx` | Create | Bottom-sheet form (host / API port / password / TLS) + `pingServer`. Consumed by `/pair`. |
| `packages/mobile/lib/ui.tsx` | Modify | Add a `Sheet` primitive (`Modal transparent animationType="slide"`, backdrop, bottom-anchored card) and a `NumberedStep` row used by both new screens. |
| `packages/mobile/app/pair.tsx` | Modify | Redesign: step list, corner-bracket viewfinder, in-place errors, `pingServer` verification before navigating, `canAskAgain` handling, manual-entry footer. |
| `packages/mobile/lib/config.ts` | Modify | `httpPort` default `"3001"` → `"3011"`; correct the comment on `:11`. |
| `packages/mobile/app.json` | Modify | Add `ios.infoPlist.NSLocalNetworkUsageDescription`. |
| `packages/mobile/lib/push.ts` | Modify | `{ ask }` option. |
| `packages/mobile/lib/PushManager.tsx` | Modify | Pass `ask: false`. |
| `packages/mobile/app/(tabs)/index.tsx` | Modify | Empty-state action targets `/onboarding`, relabeled. |
| `frontend/src/renderer/components/settings/ConnectMobileSetup.tsx` | Modify | "tap Scan" → "tap Pair Desktop". |

`lib/PairScanner.tsx` from v1 is dropped. With the scanner living on exactly one
route, extracting a component has no second caller to justify it.

### Camera permission recovery

`app/pair.tsx:60-69` branches only on `permission.granted` and always renders
"Grant camera access" wired to `requestPermission`. It never reads
`permission.canAskAgain`, so after a permanent denial that button is a no-op.
The redesign must handle this, matching the treatment notifications already get
(`lib/pushStatus.ts:97-103`): when `!canAskAgain`, swap the button for "Open
settings" calling `Linking.openSettings()`, and always keep "Enter details
manually" reachable.

## Testing

`npm test` in `packages/mobile` is bare `vitest run` and there is no React
Native component-test setup. Testing is therefore pure-logic only:

- `lib/onboarding.test.ts`: the `shouldOnboard` truth table, including the
  configured-and-skipped and unconfigured-and-skipped cases.
- `lib/connectionError.test.ts`: each cause maps to its copy, including the
  iOS-private-host branch and the fallback for an unrecognized error.
- `lib/push.ts`: `{ ask: false }` does not call `requestPermissionsAsync` when
  permission is undetermined; `{ ask: true }` does.

Establishing an RN component-test harness is explicitly out of scope. The two
screens and the sheet are verified by running the app on a simulator, which is a
manual step in this design.

## Risks

- **Not yet verified by running.** Every finding here is read from source, with
  the port values, pairing payload, and the four defect sites checked directly.
  The permission-prompt timing, the sheet-over-camera interaction, and the
  cold-start flash are predictions until exercised on a simulator. Xcode is not
  installed in this environment.
- **Sheet over a live camera.** Keeping the camera mounted behind a `Modal` is
  the simple implementation but is untested on Android, where camera surfaces
  and modal windows have historically conflicted. Fallback if it misbehaves:
  unmount the `CameraView` while the sheet is open and remount on dismiss,
  accepting a brief black frame.
- **Two taps to pair.** The welcome screen is a deliberate cost accepted for
  framing and identity. If pairing completion rates matter more than the
  explanation, the v1 camera-first shape is the alternative and this design can
  collapse to it by making `/onboarding` a `router.replace("/pair")`.
- **Superseded by discovery.** If mDNS lands, the scanner becomes a fallback
  rather than the primary path. Keeping the error mapping pure and the sheet
  self-contained means that transition is additive.
</content>
