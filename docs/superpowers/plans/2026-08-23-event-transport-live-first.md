# Event Transport Live-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a client's cost per connect proportional to what it displays, by letting it subscribe live instead of replaying every event the daemon has ever recorded.

**Architecture:** Four additive query parameters on `GET /api/v1/events` (`from=head`, `maxCatchup`, `resync`) plus a capabilities endpoint, then the mobile and desktop clients opt in. Every change is additive: a client that asks for nothing new observes no difference, because the desktop renderer depends on current behaviour and payload contents.

**Tech Stack:** Go 1.25 (chi router, SSE) for the daemon; TypeScript + React Native (Expo 54, Hermes) for mobile; TypeScript + React (`EventSource`) for the desktop renderer. Tests: `go test ./...` and vitest.

**Spec:** `docs/superpowers/specs/2026-08-21-mobile-event-transport-scaling-design.md`

## Global Constraints

- **Additive only.** A request with no new parameters must behave exactly as it does today. The desktop renderer (`frontend/src/renderer/lib/event-transport.ts`) reads `payload.conversationId` and `payload.interfaceTransitionId` to narrow cache invalidation; never strip or reshape payloads by default.
- **PREREQUISITE: PR #4276 must be merged before Task 6.** Tasks 6 relies on `ConversationStreamOptions`, `readSseFrameSeq`, and `hasListeners` from that PR. Tasks 1-5 and 7 are independent of it.
- `MAX_CATCHUP` default = **1000** events.
- Backend lint/test: `go test ./...` then `go test -race ./...` (see `AGENTS.md`).
- Mobile tests: `npm test` from `packages/mobile`. Note: vitest runs on Node and **cannot** catch device-only failures; on-device verification is required before release, not optional.
- Cursor semantics: `X-AO-Event-After` already reports the effective starting cursor. Reuse it for every clamp rather than inventing a second channel.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `backend/internal/httpd/events.go` | SSE stream: parameter parsing, replay, live loop, backpressure | Modify |
| `backend/internal/httpd/events_test.go` | Stream behaviour tests | Modify |
| `backend/internal/httpd/capabilities.go` | Feature advertisement endpoint | Create |
| `backend/internal/httpd/capabilities_test.go` | Endpoint tests | Create |
| `backend/internal/httpd/api.go` | Hold and register the capabilities controller | Modify |
| `packages/mobile/lib/chat/sse.ts` | Event registry: adds resync fan-out | Modify |
| `packages/mobile/lib/chat/useConversation.ts` | Refetch the open chat on resync | Modify |
| `packages/mobile/lib/chat/sse.test.ts` | Registry tests | Modify |
| `packages/mobile/lib/chat/conversationEvents.ts` | Chooses cold-start vs catch-up mode | Modify |
| `packages/mobile/lib/chat/api.ts` | Builds the stream URL | Modify |
| `packages/mobile/lib/chatModeApi.test.ts` | Stream URL and cursor tests | Modify |
| `frontend/src/renderer/lib/event-transport.ts` | Desktop SSE subscription | Modify |
| `frontend/src/renderer/lib/event-transport.test.ts` | Desktop transport tests | Modify |

---

### Task 1: Clamp a too-far-ahead cursor to head, not zero

Today a cursor beyond head resets to `0`, so a truncated or replaced `change_log` stampedes **every** connected client into a simultaneous full replay. Failing closed to head loses at most one doorbell; failing closed to zero is a thundering herd.

**Files:**
- Modify: `backend/internal/httpd/events.go:58-60`
- Test: `backend/internal/httpd/events_test.go`

**Interfaces:**
- Consumes: `c.Source.LatestSeq(ctx) (int64, error)` — already called at `events.go:52`.
- Produces: no new symbols. Behaviour change only, observable through the `X-AO-Event-After` response header.

- [ ] **Step 1: Write the failing test**

Add to `backend/internal/httpd/events_test.go`:

```go
func TestEventsStreamClampsFutureCursorToHeadNotZero(t *testing.T) {
	live := &fakeEventSubscriber{}
	src := &fakeEventSource{live: live}
	router := NewRouterWithControl(config.Config{}, discardLogger(), nil, APIDeps{
		CDC:    src,
		Events: live,
	}, ControlDeps{})
	ts := httptest.NewServer(router)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// fakeEventSource reports LatestSeq of 2; ask for a cursor far beyond it.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/events?after=99999", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/v1/events: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("X-AO-Event-After"); got != "2" {
		t.Fatalf("X-AO-Event-After = %q, want %q (head, not a full replay from 0)", got, "2")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./backend/internal/httpd/ -run TestEventsStreamClampsFutureCursorToHeadNotZero -v`
Expected: FAIL — `X-AO-Event-After = "0", want "2"`.

If `fakeEventSource` does not report `LatestSeq` of 2, read its definition near the top of `events_test.go` and use its actual value in the assertion instead. Do not change the fake.

- [ ] **Step 3: Write minimal implementation**

In `backend/internal/httpd/events.go`, replace:

```go
	if after > latestSeq {
		after = 0
	}
```

with:

```go
	// A cursor ahead of head means the change_log was truncated or replaced.
	// Fall closed to head, never to zero: resetting to zero stampedes every
	// connected client into a simultaneous full replay.
	if after > latestSeq {
		after = latestSeq
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./backend/internal/httpd/ -run TestEvents -v`
Expected: PASS, including the pre-existing stream tests.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpd/events.go backend/internal/httpd/events_test.go
git commit -m "fix(events): clamp a future cursor to head instead of replaying from zero"
```

---

### Task 2: Add `from=head` for live-only subscription

**Files:**
- Modify: `backend/internal/httpd/events.go`
- Test: `backend/internal/httpd/events_test.go`

**Interfaces:**
- Produces: `func parseEventsFromHead(r *http.Request) bool` in `events.go`. Returns true when the `from` query parameter equals `head`. Task 6 and Task 7 send this parameter.

- [ ] **Step 1: Write the failing test**

```go
func TestEventsStreamFromHeadSkipsReplay(t *testing.T) {
	live := &fakeEventSubscriber{}
	src := &fakeEventSource{live: live}
	router := NewRouterWithControl(config.Config{}, discardLogger(), nil, APIDeps{
		CDC:    src,
		Events: live,
	}, ControlDeps{})
	ts := httptest.NewServer(router)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/events?from=head", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/v1/events: %v", err)
	}
	defer resp.Body.Close()

	// The effective cursor is head, so nothing historical is replayed.
	if got := resp.Header.Get("X-AO-Event-After"); got != "2" {
		t.Fatalf("X-AO-Event-After = %q, want %q", got, "2")
	}
	// Only the live event published after subscription arrives.
	live.publish(testCDCEvent(3))
	ids := readSSEIDs(t, resp.Body, 1)
	if got, want := strings.Join(ids, ","), "3"; got != want {
		t.Fatalf("ids = %s, want %s (no historical replay)", got, want)
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./backend/internal/httpd/ -run TestEventsStreamFromHeadSkipsReplay -v`
Expected: FAIL — the header reads `0` and historical ids `1,2` arrive first.

- [ ] **Step 3: Write minimal implementation**

Add near `parseEventsAfter` in `events.go`:

```go
// parseEventsFromHead reports whether the client asked to subscribe live with no
// replay. History is served by the paginated conversation snapshot endpoints, so
// a client that only needs change notifications has no use for the backlog.
func parseEventsFromHead(r *http.Request) bool {
	return r.URL.Query().Get("from") == "head"
}
```

Then in `stream`, replace the clamp block from Task 1 with:

```go
	if parseEventsFromHead(r) {
		after = latestSeq
	} else if after > latestSeq {
		// A cursor ahead of head means the change_log was truncated or replaced.
		// Fall closed to head, never to zero.
		after = latestSeq
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./backend/internal/httpd/ -run TestEvents -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpd/events.go backend/internal/httpd/events_test.go
git commit -m "feat(events): add from=head for live-only subscription"
```

---

### Task 3: Add `maxCatchup` to bound replay

A client cannot know the daemon's head before it connects, so it cannot decide for itself whether its gap is small enough to replay. It states a limit; the daemon clamps and reports the effective cursor through the existing `X-AO-Event-After` header.

**Files:**
- Modify: `backend/internal/httpd/events.go`
- Test: `backend/internal/httpd/events_test.go`

**Interfaces:**
- Produces: `func parseEventsMaxCatchup(r *http.Request) (int64, bool)` in `events.go`. Returns the parsed limit and whether one was supplied. Invalid or negative values are treated as absent.

- [ ] **Step 1: Write the failing test**

```go
func TestEventsStreamMaxCatchupClampsLargeGapToHead(t *testing.T) {
	live := &fakeEventSubscriber{}
	src := &fakeEventSource{live: live}
	router := NewRouterWithControl(config.Config{}, discardLogger(), nil, APIDeps{
		CDC:    src,
		Events: live,
	}, ControlDeps{})
	ts := httptest.NewServer(router)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	// Head is 2; asking from 0 with a limit of 1 exceeds the allowed gap.
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/events?after=0&maxCatchup=1", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/v1/events: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("X-AO-Event-After"); got != "2" {
		t.Fatalf("X-AO-Event-After = %q, want %q (gap exceeded the limit)", got, "2")
	}
}

func TestEventsStreamMaxCatchupAllowsSmallGap(t *testing.T) {
	live := &fakeEventSubscriber{}
	src := &fakeEventSource{live: live}
	router := NewRouterWithControl(config.Config{}, discardLogger(), nil, APIDeps{
		CDC:    src,
		Events: live,
	}, ControlDeps{})
	ts := httptest.NewServer(router)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/events?after=0&maxCatchup=1000", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/v1/events: %v", err)
	}
	defer resp.Body.Close()

	if got := resp.Header.Get("X-AO-Event-After"); got != "0" {
		t.Fatalf("X-AO-Event-After = %q, want %q (gap was within the limit)", got, "0")
	}
	ids := readSSEIDs(t, resp.Body, 2)
	if got, want := strings.Join(ids, ","), "1,2"; got != want {
		t.Fatalf("ids = %s, want %s", got, want)
	}
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `go test ./backend/internal/httpd/ -run TestEventsStreamMaxCatchup -v`
Expected: the clamping test FAILS (`X-AO-Event-After = "0", want "2"`); the small-gap test passes already, which is correct — it guards against over-clamping.

- [ ] **Step 3: Write minimal implementation**

Add beside `parseEventsFromHead`:

```go
// parseEventsMaxCatchup reads the largest replay the client is willing to accept.
// A client cannot know head before connecting, so it states a limit and the
// daemon clamps. An absent, malformed, or negative value means "no limit", which
// preserves today's behaviour for clients that do not send it.
func parseEventsMaxCatchup(r *http.Request) (int64, bool) {
	raw := r.URL.Query().Get("maxCatchup")
	if raw == "" {
		return 0, false
	}
	limit, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || limit < 0 {
		return 0, false
	}
	return limit, true
}
```

Extend the cursor block in `stream`:

```go
	if parseEventsFromHead(r) {
		after = latestSeq
	} else if after > latestSeq {
		// A cursor ahead of head means the change_log was truncated or replaced.
		// Fall closed to head, never to zero.
		after = latestSeq
	} else if limit, ok := parseEventsMaxCatchup(r); ok && latestSeq-after > limit {
		// The gap is larger than the client will accept. Jump to head; it
		// resynchronises from snapshots rather than draining the backlog.
		after = latestSeq
	}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./backend/internal/httpd/ -run TestEvents -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpd/events.go backend/internal/httpd/events_test.go
git commit -m "feat(events): add maxCatchup to bound replay for slow clients"
```

---

### Task 4: Replace overflow-cancel with an opt-in resync signal

Today a full live buffer cancels the stream (`events.go:72-80`); the client reconnects and replays. That degrades *worse* under load, which is exactly backwards. Opt-in via `resync=1` so the desktop's existing reconnect behaviour is untouched.

**Files:**
- Modify: `backend/internal/httpd/events.go`
- Test: `backend/internal/httpd/events_test.go`

**Interfaces:**
- Produces: a `resync` SSE event whose data is `{"type":"resync","seq":<head>}`, emitted only when `resync=1` is present. Task 6 consumes it.

- [ ] **Step 1: Write the failing test**

```go
func TestEventsStreamResyncReplacesStreamCancelOnOverflow(t *testing.T) {
	live := &fakeEventSubscriber{}
	src := &fakeEventSource{live: live}
	router := NewRouterWithControl(config.Config{}, discardLogger(), nil, APIDeps{
		CDC:    src,
		Events: live,
	}, ControlDeps{})
	ts := httptest.NewServer(router)
	defer ts.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, ts.URL+"/api/v1/events?from=head&resync=1", nil)
	if err != nil {
		t.Fatalf("new request: %v", err)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("GET /api/v1/events: %v", err)
	}
	defer resp.Body.Close()

	// Overrun the live buffer so the broadcaster hits the non-blocking default.
	for i := 0; i < eventsLiveBuffer+16; i++ {
		live.publish(testCDCEvent(int64(100 + i)))
	}

	body := bufio.NewReader(resp.Body)
	deadline := time.Now().Add(3 * time.Second)
	sawResync := false
	for time.Now().Before(deadline) && !sawResync {
		line, err := body.ReadString('\n')
		if err != nil {
			break
		}
		if strings.HasPrefix(line, "event: resync") {
			sawResync = true
		}
	}
	if !sawResync {
		t.Fatal("expected a resync event instead of the stream being cancelled")
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./backend/internal/httpd/ -run TestEventsStreamResync -v`
Expected: FAIL — the stream closes on overflow, so `ReadString` errors before any `event: resync` line.

Add `"bufio"` to the test file's imports if it is not already there.

- [ ] **Step 3: Write minimal implementation**

In `stream`, replace the subscription block:

```go
	live := make(chan cdc.Event, eventsLiveBuffer)
	unsubscribe := c.Live.Subscribe(func(e cdc.Event) {
		select {
		case live <- e:
		default:
			// Never block the broadcaster. Closing the stream is safer than
			// silently dropping a live event; the client replays on reconnect.
			cancel()
		}
	})
```

with:

```go
	wantsResync := r.URL.Query().Get("resync") == "1"
	live := make(chan cdc.Event, eventsLiveBuffer)
	overflowed := make(chan struct{}, 1)
	unsubscribe := c.Live.Subscribe(func(e cdc.Event) {
		select {
		case live <- e:
		default:
			// Never block the broadcaster. A client that asked for resync is told
			// to refetch and jump forward; one that did not keeps the old
			// behaviour, where closing the stream is safer than dropping an event
			// silently.
			if !wantsResync {
				cancel()
				return
			}
			select {
			case overflowed <- struct{}{}:
			default:
			}
		}
	})
```

Add the `overflowed` case to the live loop:

```go
	for {
		select {
		case <-ctx.Done():
			return
		case <-overflowed:
			head, err := c.Source.LatestSeq(ctx)
			if err != nil {
				return
			}
			if err := writeSSEResync(w, flusher, head, &sentSeq); err != nil {
				return
			}
		case e := <-live:
			if err := writeSSEEvent(w, flusher, e, &sentSeq); err != nil {
				return
			}
		}
	}
```

And add the writer beside `writeSSEEvent`:

```go
// writeSSEResync tells a client that fell behind to refetch its visible state and
// jump its cursor to head. It replaces a replay of everything it missed with a
// single refetch, so falling behind costs a bounded amount of work.
func writeSSEResync(w http.ResponseWriter, flusher http.Flusher, head int64, sentSeq *int64) error {
	if _, err := fmt.Fprintf(w, "id: %d\nevent: resync\ndata: {\"type\":\"resync\",\"seq\":%d}\n\n", head, head); err != nil {
		return err
	}
	if head > *sentSeq {
		*sentSeq = head
	}
	flusher.Flush()
	return nil
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./backend/internal/httpd/ -run TestEvents -v` then `go test -race ./backend/internal/httpd/`
Expected: PASS. The race check matters here — `overflowed` is written from the broadcaster goroutine and read by the stream goroutine.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpd/events.go backend/internal/httpd/events_test.go
git commit -m "feat(events): send a resync signal on overflow instead of cancelling the stream"
```

---

### Task 5: Add a capabilities endpoint

There is no version or capabilities endpoint — only `/healthz` and `/readyz`. Without one, a new client cannot tell whether `from=head` will be honoured or silently ignored by an older daemon, and being ignored means a full replay.

**Files:**
- Create: `backend/internal/httpd/capabilities.go`
- Create: `backend/internal/httpd/capabilities_test.go`
- Modify: `backend/internal/httpd/router.go`

**Interfaces:**
- Produces: `GET /api/v1/capabilities` returning `{"features":["events.from_head","events.max_catchup","events.resync"]}`. Clients treat an unknown feature as absent and a 404 as "old daemon, no features".

- [ ] **Step 1: Write the failing test**

Create `backend/internal/httpd/capabilities_test.go`:

```go
package httpd

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/aoagents/agent-orchestrator/backend/internal/config"
)

func TestCapabilitiesAdvertisesEventFeatures(t *testing.T) {
	router := NewRouterWithControl(config.Config{}, discardLogger(), nil, APIDeps{}, ControlDeps{})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/capabilities", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var body struct {
		Features []string `json:"features"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	want := map[string]bool{"events.from_head": false, "events.max_catchup": false, "events.resync": false}
	for _, f := range body.Features {
		if _, ok := want[f]; ok {
			want[f] = true
		}
	}
	for feature, seen := range want {
		if !seen {
			t.Fatalf("features %v missing %q", body.Features, feature)
		}
	}
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `go test ./backend/internal/httpd/ -run TestCapabilities -v`
Expected: FAIL — status 404, the route does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `backend/internal/httpd/capabilities.go`:

```go
package httpd

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"
)

// capabilityFeatures is what this daemon can be asked for. Clients negotiate
// against it instead of guessing from a version number, and treat a 404 as an
// older daemon that supports none of it.
var capabilityFeatures = []string{
	"events.from_head",
	"events.max_catchup",
	"events.resync",
}

// CapabilitiesController advertises optional protocol features.
type CapabilitiesController struct{}

// Register mounts the capabilities route.
func (c *CapabilitiesController) Register(r chi.Router) {
	r.Get("/capabilities", c.get)
}

func (c *CapabilitiesController) get(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_ = json.NewEncoder(w).Encode(map[string][]string{"features": capabilityFeatures})
}
```

Controllers are held as fields on the API struct and registered together. In `backend/internal/httpd/api.go`, add the field beside `events` (near line 111):

```go
	capabilities  *CapabilitiesController
```

Construct it in the same literal that builds `events` (near line 148):

```go
		capabilities:  &CapabilitiesController{},
```

And register it immediately after `a.events.Register(r)` (line 187):

```go
		a.capabilities.Register(r)
```

Note the file is `api.go`, not `router.go` — the File Structure table above says `router.go`; `api.go` is correct.

- [ ] **Step 4: Run tests to verify they pass**

Run: `go test ./backend/internal/httpd/ -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/internal/httpd/capabilities.go backend/internal/httpd/capabilities_test.go backend/internal/httpd/router.go
git commit -m "feat(api): advertise optional event-stream features via /capabilities"
```

---

### Task 6: Mobile — subscribe live on cold start, bound catch-up otherwise

**PREREQUISITE: PR #4276 must be merged before starting this task.**

**Files:**
- Modify: `packages/mobile/lib/chat/api.ts` (the `streamGlobalConversationEvents` URL)
- Modify: `packages/mobile/lib/chat/conversationEvents.ts:32-58`
- Test: `packages/mobile/lib/chatModeApi.test.ts`

**Interfaces:**
- Consumes: `streamGlobalConversationEvents(cfg, after, signal, onEvent, onCursorReset?, options?)` and `ConversationStreamOptions` from PR #4276.
- Produces: `ConversationStreamOptions` gains `fromHead?: boolean` and `maxCatchup?: number`. When `fromHead` is true the request omits `after` and sends `from=head`.

- [ ] **Step 1: Write the failing test**

Add to `packages/mobile/lib/chatModeApi.test.ts`:

```ts
it("subscribes live instead of replaying when there is no stored cursor", async () => {
	vi.mocked(expoFetch).mockResolvedValue(new Response("") as unknown as Awaited<ReturnType<typeof expoFetch>>);

	await chatApi.streamGlobalConversationEvents(
		cfg, 0, new AbortController().signal, () => {}, undefined, { fromHead: true },
	);

	const url = String(vi.mocked(expoFetch).mock.calls[0]?.[0]);
	expect(url).toContain("from=head");
	expect(url).not.toContain("after=");
});

it("bounds how much history it will accept when resuming from a cursor", async () => {
	vi.mocked(expoFetch).mockResolvedValue(new Response("") as unknown as Awaited<ReturnType<typeof expoFetch>>);

	await chatApi.streamGlobalConversationEvents(
		cfg, 42, new AbortController().signal, () => {}, undefined, { maxCatchup: 1000 },
	);

	const url = String(vi.mocked(expoFetch).mock.calls[0]?.[0]);
	expect(url).toContain("after=42");
	expect(url).toContain("maxCatchup=1000");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/mobile && npx vitest run lib/chatModeApi.test.ts`
Expected: FAIL — the URL always contains `after=` and never `from=head`.

- [ ] **Step 3: Write minimal implementation**

In `packages/mobile/lib/chat/api.ts`, extend the options type:

```ts
export type ConversationStreamOptions = {
	/** Frames handled between cooperative yields back to the event loop. */
	yieldEvery?: number;
	/** When this returns false, frames advance the cursor without being parsed. */
	wantsPayload?: () => boolean;
	/** A frame that advanced the cursor without being parsed. */
	onCursorAdvance?: (seq: number) => void;
	/** Subscribe live with no replay. History comes from conversation snapshots. */
	fromHead?: boolean;
	/** Largest replay to accept before the daemon jumps us to head instead. */
	maxCatchup?: number;
};
```

Replace the URL construction:

```ts
	const res = await expoFetch(`${httpBase(cfg)}${API}/events?after=${Math.max(0, after)}`, {
```

with:

```ts
	const query = new URLSearchParams();
	if (options?.fromHead) {
		// No stored cursor, so there is nothing to resume — and no reason to
		// download history the snapshot endpoints already serve.
		query.set("from", "head");
	} else {
		query.set("after", String(Math.max(0, after)));
		if (options?.maxCatchup !== undefined) query.set("maxCatchup", String(options.maxCatchup));
	}
	query.set("resync", "1");
	const res = await expoFetch(`${httpBase(cfg)}${API}/events?${query.toString()}`, {
```

In `packages/mobile/lib/chat/conversationEvents.ts`, add beside `RECONNECT_MIN_MS`:

```ts
/**
 * Largest replay the phone will accept before jumping to head instead.
 *
 * It must cover a brief disconnect — a tunnel, a backgrounded app, a Wi-Fi
 * handover — without approaching the JNI global-reference ceiling that aborts
 * the process, and it must be cheap to abandon: exceeding it costs exactly one
 * snapshot refetch.
 */
const MAX_CATCHUP = 1000;
```

Then change the stream call so a missing cursor subscribes live:

```ts
				const stored = Number(await AsyncStorage.getItem(cursorKey));
				const hasCursor = Number.isFinite(stored) && stored > 0;
				cursor = hasCursor ? stored : 0;
```

Note: this replaces the existing `let cursor = Number(...) || 0;` line. Move it above the `while` loop as it already is, and pass the mode through:

```ts
					{
						fromHead: !hasCursor,
						maxCatchup: MAX_CATCHUP,
						wantsPayload: () => registry.hasListeners(),
						onCursorAdvance: (seq) => {
							cursor = Math.max(cursor, seq);
							cursorPersister.update(cursor);
						},
					},
```

After the first successful stream, `hasCursor` must become true so a reconnect resumes rather than skipping events. Set it where the loop already resets backoff:

```ts
					delay = RECONNECT_MIN_MS;
					hasCursor = true;
```

Declare it with `let hasCursor = ...` rather than `const` for this reason.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/mobile && npm test && npx tsc --noEmit`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/lib/chat/api.ts packages/mobile/lib/chat/conversationEvents.ts packages/mobile/lib/chatModeApi.test.ts
git commit -m "feat(mobile): subscribe live on cold start and bound catch-up on resume"
```

---

### Task 7: Desktop — stop replaying all history on connect

The desktop renderer connects with no `after` at all, so `parseEventsAfter` falls back to an absent `Last-Event-ID` and returns 0 — a full replay on every fresh connect. It survives on loopback, but it is the same waste.

`EventSource` sends `Last-Event-ID` automatically on its own reconnects, and that takes precedence over the query string only when `after` is absent — which it still is. So adding `from=head` affects the **first** connect, while browser-driven reconnects continue to resume correctly.

**Files:**
- Modify: `frontend/src/renderer/lib/event-transport.ts:147`
- Test: `frontend/src/renderer/lib/event-transport.test.ts`

**Interfaces:**
- Consumes: `from=head` from Task 2.
- Produces: no new symbols.

- [ ] **Step 1: Write the failing test**

In `frontend/src/renderer/lib/event-transport.test.ts`, the existing assertions expect a bare URL. Add a new test beside them:

```ts
it("subscribes live rather than replaying every event on first connect", () => {
	createEventTransport(fakeQueryClient()).connect();

	expect(EventSourceStub.instances[0].url).toBe("http://127.0.0.1:3001/api/v1/events?from=head");
});
```

`fakeQueryClient()` and `EventSourceStub` are the file's existing helpers — the same ones used by "opens a single SSE connection to the current base URL on connect" at line 82. The `afterEach` already deletes the `EventSource` global, so no teardown is needed in the test body.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run --config vite.renderer.config.ts src/renderer/lib/event-transport.test.ts`
Expected: FAIL — url is `http://127.0.0.1:3001/api/v1/events` without the query.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/renderer/lib/event-transport.ts`, change:

```ts
					source = new EventSource(`${baseUrl.replace(/\/+$/, "")}/api/v1/events`);
```

to:

```ts
					// Subscribe live: this transport only invalidates caches, so replaying
					// the daemon's whole history on connect fetches work it discards.
					// EventSource still resumes via Last-Event-ID on its own reconnects.
					source = new EventSource(`${baseUrl.replace(/\/+$/, "")}/api/v1/events?from=head`);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && npx vitest run --config vite.renderer.config.ts src/renderer/lib/event-transport.test.ts`
Expected: PASS. The three pre-existing url assertions (lines 86, 111, 257, 274) will now fail — update each expected string to include `?from=head`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/renderer/lib/event-transport.ts frontend/src/renderer/lib/event-transport.test.ts
git commit -m "feat(desktop): subscribe live instead of replaying history on connect"
```

---

### Task 8: Mobile — act on a resync signal

Task 6 asks for `resync=1`, so the daemon will stop cancelling the stream when this client falls behind. That is only an improvement if the client then refetches: without this task the stream stays open, the cursor jumps to head, and an open chat silently goes stale — a worse failure than the reconnect it replaced.

The board needs nothing here; its 8-second poll (`lib/store.tsx:264`) already self-heals. Only the open conversation does.

**Files:**
- Modify: `packages/mobile/lib/chat/sse.ts` (registry)
- Modify: `packages/mobile/lib/chat/conversationEvents.ts` (detect and dispatch)
- Modify: `packages/mobile/lib/chat/useConversation.ts:213-218` (subscribe)
- Test: `packages/mobile/lib/chat/sse.test.ts`

**Interfaces:**
- Produces: `ConversationEventRegistry` gains `subscribeResync(listener: () => void): () => void` and `publishResync(): void`.
- Produces: `subscribeConversationResync(listener: () => void): () => void` exported from `conversationEvents.ts`, mirroring the existing `subscribeConversationEvents`.

- [ ] **Step 1: Write the failing test**

Add to `packages/mobile/lib/chat/sse.test.ts`, inside the `conversation event subscriptions` describe block:

```ts
it("notifies every resync listener regardless of session", () => {
	const registry = sse.createConversationEventRegistry();
	const seen: string[] = [];
	const stopA = registry.subscribeResync(() => seen.push("a"));
	registry.subscribeResync(() => seen.push("b"));

	registry.publishResync();
	expect(seen).toEqual(["a", "b"]);

	stopA();
	registry.publishResync();
	expect(seen).toEqual(["a", "b", "b"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/mobile && npx vitest run lib/chat/sse.test.ts`
Expected: FAIL — `registry.subscribeResync is not a function`.

- [ ] **Step 3: Write minimal implementation**

In `packages/mobile/lib/chat/sse.ts`, extend the registry type:

```ts
export type ConversationEventRegistry = {
	subscribe(sessionId: string, listener: (event: ConversationEvent) => void): () => void;
	publish(event: ConversationEvent): void;
	/** Whether any session has a listener, i.e. whether payloads are worth parsing. */
	hasListeners(): boolean;
	/** Notified when the daemon says we fell behind and should refetch. */
	subscribeResync(listener: () => void): () => void;
	publishResync(): void;
};
```

And in `createConversationEventRegistry`, add beside `listeners`:

```ts
	const resyncListeners = new Set<() => void>();
```

with these members:

```ts
		subscribeResync(listener) {
			resyncListeners.add(listener);
			return () => {
				resyncListeners.delete(listener);
			};
		},
		publishResync() {
			for (const listener of resyncListeners) listener();
		},
```

In `packages/mobile/lib/chat/conversationEvents.ts`, export a subscription beside `subscribeConversationEvents`:

```ts
/** Fires when the daemon reports we fell behind; refetch rather than replay. */
export function subscribeConversationResync(listener: () => void): () => void {
	return registry.subscribeResync(listener);
}
```

And intercept the frame in the stream's `onEvent` callback, before the existing cursor handling:

```ts
						(event) => {
							if (event.type === "resync") {
								// Not a change to any one session: we were dropped from the
								// live buffer, so everything on screen may be stale.
								cursor = Math.max(cursor, event.seq);
								cursorPersister.update(cursor);
								registry.publishResync();
								return;
							}
							cursor = Math.max(cursor, event.seq);
							cursorPersister.update(cursor);
							registry.publish(event);
						},
```

In `packages/mobile/lib/chat/useConversation.ts`, add a second effect beside the existing subscription at line 213:

```ts
	useEffect(() => {
		if (!cfg || unavailable) return;
		return subscribeConversationResync(() => scheduleRefresh());
	}, [cfg, scheduleRefresh, unavailable]);
```

and extend its import:

```ts
import { subscribeConversationEvents, subscribeConversationResync } from "./conversationEvents";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/mobile && npm test && npx tsc --noEmit`
Expected: PASS, all suites.

- [ ] **Step 5: Commit**

```bash
git add packages/mobile/lib/chat/sse.ts packages/mobile/lib/chat/conversationEvents.ts packages/mobile/lib/chat/useConversation.ts packages/mobile/lib/chat/sse.test.ts
git commit -m "feat(mobile): refetch the open conversation when the daemon signals a resync"
```

---

## Final verification

Automated suites cannot prove this works — the failure they replace was a native abort on a device. Run both, then verify on hardware.

- [ ] `go test ./... && go test -race ./...` from the repo root
- [ ] `npm test && npx tsc --noEmit` from `packages/mobile`
- [ ] `npx vitest run --config vite.renderer.config.ts` from `frontend`
- [ ] **On-device gate.** With a daemon holding 100k+ events: `adb shell pm clear aoagents.dev`, install a release build, connect. Expect **no drain at all** — not merely a survivable one.
- [ ] **Measure it.** Re-run the drain probe against the daemon and confirm a fresh connect delivers ~0 historical events:

```bash
curl -sN --max-time 6 -H "Accept: text/event-stream" \
  "http://127.0.0.1:<port>/api/v1/events?from=head" | grep -c '^data:'
```

Baseline for comparison: `?after=0` on an 80-session daemon returned 196,658 events / 47MB and was still streaming at 6s.

- [ ] **Desktop regression.** Launch the desktop app, confirm sessions still update live when an agent runs — its cache invalidation depends on payload contents that must be unchanged.
