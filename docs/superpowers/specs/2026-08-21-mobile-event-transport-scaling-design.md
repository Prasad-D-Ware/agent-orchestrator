# Mobile Event Transport Scaling Design

## Goal

Make the phone's workload proportional to **what is on screen** and to the **live
change rate**, never to history size or session count.

Today it is proportional to total history. On a daemon with 80 sessions that meant
196,658 events and 47MB on every fresh connect, which aborted the Android app
outright (see `d85869905` for the mitigation and the measurements behind it).

The invariant this design commits to:

> A client's cost per connect is O(what it displays). Adding history, sessions, or
> events to a daemon must not change what a connecting phone downloads.

## Why the shipped fix is not sufficient

`d85869905` makes a large replay survivable — the reader yields, the cursor persists,
payloads nobody reads are not parsed. It does **not** make the replay smaller. 47MB
still crosses the network, and the ceiling that aborted the app is structural:

`expo/fetch`'s streaming body (`expo.modules.fetch.NativeResponse.pumpResponseBodyStream`)
emits one event to JS per chunk, each taking a JNI global reference released only once
JS consumes it. Android's global reference table holds **51,200**. The pump has **no
backpressure** — it reads from OkHttp as fast as the network delivers regardless of
whether JS keeps up. Yielding buys headroom; it does not raise the ceiling. A daemon
with several times this history reaches it again.

The ceiling cannot be raised from the client. It can only be avoided by not streaming
history.

## The three violations

| # | Violation | Scales with | Where |
|---|---|---|---|
| 1 | Cold-start replay from cursor 0 | all history, per fresh install | `packages/mobile/lib/chat/conversationEvents.ts:33` |
| 2 | Overflow cancels the stream, client replays | all history, *repeatedly under load* | `backend/internal/httpd/events.go:72-80` |
| 3 | Board poll fetches every session | all sessions, every 8s | `packages/mobile/lib/store.tsx:264`, `lib/api.ts:353` |

Violation 2 is the most dangerous: it degrades *worse* as the client struggles, which
is precisely when it should degrade better.

A fourth, non-scaling defect belongs with them: `events.go:58-60` resets a cursor ahead
of head to `0`, so a truncated or replaced `change_log` stampedes **every** connected
client into a simultaneous full replay.

## The waste is total, not merely excessive

The entire global stream exists to serve one consumer:

```js
// packages/mobile/lib/chat/useConversation.ts:213-218
return subscribeConversationEvents(sessionId, (event) => {
    if (event.payload?.conversationId) scheduleRefresh();
});
```

The payload is discarded. The consumer checks one field for truthiness and re-fetches
the conversation over REST. History already loads through paginated snapshots
(`useConversation.ts:156-167`, `getConversationPage` with `oldestSequence` /
`hasMoreBefore`).

So the stream is a **doorbell**: "session X changed, refetch it." It is delivering
documents to convey one bit, for every session, for all time — when only the session
currently on screen has a subscriber at all.

That mismatch — a global, durable, full-payload replay stream serving a single-session,
live-only, payload-free need — is the architectural defect. Everything else is a symptom.

## The second consumer

`/api/v1/events` is not mobile-only. The desktop renderer subscribes to it via
`EventSource` (`frontend/src/renderer/lib/event-transport.ts:147`). Two consequences
shape this design:

**The desktop replays too.** It connects with no `?after=` at all. `parseEventsAfter`
falls back to `Last-Event-ID`, absent on a first connect, so it returns `0` — the
desktop performs the same full replay on every fresh connect. It survives because it is
Electron on loopback with a browser `EventSource`: no JNI ceiling, ample memory. Wasteful
rather than fatal. `from=head` therefore benefits the desktop as well, at no extra cost.

**The desktop reads payloads; the phone does not.** `event-transport.ts:60-94` extracts
`payload.interfaceTransitionId` and `payload.conversationId` to decide what to refresh.
Notify mode must therefore be **opt-in per client**, never a change to the default
response shape. The phone requests payload-free events; the desktop keeps full ones.

Every change below is additive to the wire format for this reason. A client that asks
for nothing new must observe no difference.

### The two clients want opposite things

| | Mobile | Desktop |
|---|---|---|
| Sessions it must react to | the one on screen | all of them (it renders a board) |
| Payloads | discarded | used to *narrow* invalidation (`event-transport.ts:60-94`) |
| Transport | network, phone memory, JNI ceiling | loopback, ample memory |
| Coalescing | none — parses every event | already debounced client-side |

The desktop is not a degraded mobile client; it handles the same firehose well. Its only
real defect is replaying history it does not need.

So the split is: **shared defects are fixed for both** (`from=head`, the clamp, resync
backpressure, server-side coalescing — all free wins for the desktop), while **divergent
needs become per-client options** (notify mode and subscription scoping are requested by
the phone, never imposed).

Applying notify mode or scoping to the desktop would make it *worse*: without
`payload.conversationId` it must invalidate more broadly, and without all-session events
its board goes stale. This is the concrete reason the opt-in rule above is not merely
defensive tidiness.

## Design

### Layer 1 — Client robustness (shipped, `d85869905`)

Retained as the compatibility floor, not as the fix. Documented here because Layer 2
depends on it (see Rollout).

### Layer 2 — Protocol: live-first, never replay

**`GET /api/v1/events?from=head`** — subscribe live with no replay, using the
`LatestSeq` the daemon already computes (`backend/internal/cdc/poller.go:20-23`).

**Clamp instead of resetting.** `events.go:58-60` changes from `after = 0` to
`after = latestSeq`. Failing closed to head loses a doorbell; failing closed to zero
stampedes every client.

**Bounded catch-up.** The client replays only when `head - cursor <= MAX_CATCHUP`.
Beyond that it jumps to head and emits one `resync`. History comes from REST snapshots,
so a gap costs one refetch — not 196k events.

`MAX_CATCHUP = 1000` events. Rationale: it must cover a brief disconnect (a tunnel, a
backgrounded app, a Wi-Fi handover) without ever approaching the 51,200 JNI ceiling,
and it must be cheap to abandon — a client that exceeds it pays exactly one snapshot
refetch. 1000 is roughly two orders of magnitude below the ceiling and a small multiple
of a busy minute's events. Tune with the drain-time probe under Verification; the
correct value is the largest one whose replay stays imperceptible on a mid-range device.

**Backpressure degrades to resync, never to replay.** `events.go:72-80` currently
cancels the stream on live-buffer overflow, and the client reconnects into a replay.
It instead sends `{type: "resync", seq: <head>}`: refetch what is visible, set the
cursor to head, carry on. Bounded, and it cannot storm.

*Result: cold start becomes O(1). Backpressure stops amplifying.*

### Layer 3 — Scope: send only what is displayed

**Notify mode** — events carry `{seq, sessionId, type}` with no payload. Requires a
small client change, since `useConversation.ts:216` gates on `payload.conversationId`;
it becomes a check on `sessionId`.

**Server-side coalescing** — events for the same session within a flush window collapse
to one. N changes to one session is one refetch regardless, so sending N doorbells is
waste.

Flush window: **100ms**. Below roughly 150ms a doorbell is indistinguishable from
instant to a user waiting on a refetch, and 100ms collapses the bursts that matter —
an agent streaming tokens emits far faster than that. The client already debounces via
`scheduleRefresh`, so this is about not sending the events, not about not reacting to
them.

**Subscription scoping** — the client declares the session it has open; the daemon sends
nothing else.

**Board pagination** — `/sessions` returns live sessions plus an archived *count*; the
archived list loads on expand. The drawer starts collapsed
(`app/(tabs)/index.tsx:46` passes `data: archiveOpen ? archived : []`), so with 73
archived sessions the common case fetches and renders none of them.

*Result: stream is O(visible), poll is O(visible). 80 sessions and 80,000 behave alike.*

### Capabilities negotiation

There is no version or capabilities endpoint — only `/healthz` and `/readyz`
(`backend/internal/httpd/router.go:90`). A new client sending `?from=head` to an old
daemon gets `parseEventsAfter` returning 0 and therefore a **full replay** — the exact
failure being removed.

This design adds **`GET /api/v1/capabilities`** returning a feature list, so protocol
changes negotiate explicitly rather than depending on clients surviving old behaviour.

*Assumption flagged for review: worth the small addition, because this will not be the
last protocol change. Reject it and Layer 2 still works, relying on Layer 1 instead.*

## Rollout order (forced, not preferred)

Desktops update on their own schedule, so new-phone-against-old-daemon is guaranteed.
Layer 1 must therefore ship first — and it already has. It is what makes an old daemon's
full replay survivable, and therefore what makes Layer 2 safe to deploy at all.

1. **Layer 1** — shipped in 1.2.1
2. **Layer 2** — `from=head`, clamp, bounded catch-up, resync backpressure, capabilities
3. **Layer 3** — notify mode, coalescing, scoping, board pagination

Layer 2 is the smallest change that removes the failure class. Layer 3 is the endgame.

## Verification

Unit tests cannot catch this class of bug: vitest runs on Node, and the failure is a
JNI ceiling on a device. Every layer needs on-device verification against a daemon with
real history.

- Go tests in `backend/internal/httpd/events_test.go` cover `from=head`, the clamp, and
  that overflow emits `resync` rather than cancelling.
- Client tests cover bounded catch-up and the notify-mode payload shape.
- **On-device gate:** fresh install (`adb shell pm clear aoagents.dev`) against a daemon
  with 100k+ events must connect with no measurable drain, on both platforms.
- **Regression measurement:** the `after=0` drain-time probe used during diagnosis —
  events and bytes received, and when they stop arriving. The 80-session daemon
  delivered 196,658 events / 47MB still streaming at 6s; a 5-session daemon drained
  8,663 events in 0.07s. After Layer 2, a fresh connect should deliver ~0 historical
  events regardless of daemon size.

## Scope

**In:** the `/events` contract and its mobile client; the `/sessions` board payload;
a capabilities endpoint.

**In, but only as a beneficiary:** the desktop renderer. It gains `from=head` (one
line at `frontend/src/renderer/lib/event-transport.ts:147`) so it stops replaying all
history on every connect. Its event handling is otherwise untouched, and every other
change must leave its behaviour identical.

**Out, tracked separately:**

- **Crash reporting.** There is none — no Sentry, no Crashlytics, no `ErrorUtils`
  handler, no `ErrorBoundary`. This bug took days and three wrong hypotheses because
  the only signal was a Play Console aggregate pointing at a *different* defect. Highest
  value item not in this spec.
- **Fabric `IllegalStateException`** (`SurfaceMountingManager.addViewAt`, "child already
  has a parent") — a real, separate, still-unexplained Play Console cluster. Not the
  crash diagnosed here.
- **`LayoutAnimation` under the New Architecture** — legacy pre-Fabric API with known
  mounting inconsistencies, at `app/spawn.tsx:63`,
  `lib/chat/ChatSessionScreen.tsx:113`, `lib/session/TerminalSessionScreen.tsx:665`.
  Possibly related to the cluster above.
- **`google-services.json` build dance** — should become an EAS file environment
  variable; it has cost two failed builds. See `packages/mobile/.gitignore:52`.

**Explicitly not attempted:** raising the JNI reference ceiling, or tuning the client
to outrun an unthrottled native pump. Neither is achievable; both are why Layer 2 exists.
