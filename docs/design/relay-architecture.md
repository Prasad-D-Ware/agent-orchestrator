# AO Relay — architecture and build plan

## Context

AO is local-first: a Go daemon on the user's machine owns sessions, worktrees, PTYs and
SQLite. The phone (`packages/mobile`, Expo/RN) reaches it by racing advertised endpoints —
`lan > tailscale > tunnel` (`packages/mobile/lib/race.ts`,
`backend/internal/mobilebridge/endpoints.go`). The only path that works from cellular is a
`cloudflared` quick tunnel supervised by the daemon.

`docs/adr/0004-cloudflare-tunnel-for-remote-mobile-access.md` documents three defects it
accepted, and pre-writes the justification for this work:

1. **Cloudflare sees everything.** It terminates TLS, so agent conversations, terminal I/O
   (including env vars and tokens), project/branch/PR names, and *the `Authorization: Bearer`
   connection password on every request* exist as plaintext inside their infrastructure. The
   ADR states outright: *"the only thing that [fixes this] is encrypting payloads before they
   leave the device, so whoever forwards them holds ciphertext — which is why a relay is worth
   building."*
2. **SSE is broken over the tunnel.** Measured: bodies forward in ~128 KB chunks. A 121 KB
   replay produced nothing; larger ones arrived in exact multiples of 128 K. A chat event is a
   few hundred bytes, so it is held indefinitely. Two polling stopgaps compensate today
   (`packages/mobile/lib/pollInterval.ts` 8s→2s, `packages/mobile/lib/chat/conversationPoll.ts`),
   both marked for deletion.
3. **The hostname rotates on every connector restart.** A phone that was away during the ~34s
   window holds an address that will never answer, with no way to learn the new one
   (`packages/mobile/lib/staleTunnel.ts`).

Outcome intended: a relay AO operates, which **holds only ciphertext**, carries REST + SSE +
WebSocket without buffering, and has a **stable address that never rotates** — while LAN and
Tailscale keep winning when they are available, so most traffic never touches AO infrastructure.

**The seam already exists.** `"relay"` is already a member of `EndpointKind` in
`packages/mobile/lib/endpoints.ts`, `packages/mobile/lib/pairingCode.ts` and
`frontend/src/renderer/lib/pairing-payload.ts`. No daemon emits it yet. This plan fills that slot.

---

## What the competitors actually do

Four in-repo implementations were read end to end. Two are complete relays for this exact
product shape.

| | **orca** | **paseo** | **shellular** (`app/`) | **t3code** |
|---|---|---|---|---|
| Relay in data path | yes, dumb forwarder | yes, dumb forwarder | yes, semi-aware | **no** — broker only |
| NAT traversal | reverse WS to a "cell" | reverse WS to a DO | reverse WS to regional relay | `cloudflared` named tunnel |
| E2E encrypted | **yes** (X25519+HKDF+counter nonces) | **yes** (tweetnacl box) | **yes** (secretbox, static key) | no — TLS only |
| Pairing | QR: pinned pubkey + 10-min invite | QR: pubkey in URL fragment | QR: `hostId:base64key` | Clerk OAuth + signed challenge |
| Multi-instance routing | HTTPS director + `assignmentEpoch` fencing | DO `idFromName(serverId)` | central presence table → regional URL | Postgres row + DNS |
| Hosting | regional WS fleet (not in repo) | **built on CF DO, migrated to Elixir/Fly** | regional Node (not in repo) | CF Workers + Hyperdrive |

**The five findings that shape this design:**

1. **Everyone converged on the same topology: one control socket + one data socket per client
   connection.** paseo's v1 was "broadcast to the opposite role" and broke the moment a second
   client attached (`paseo/packages/relay/src/cloudflare-adapter.ts:458`). orca and paseo-v2 are
   identical in shape: daemon holds `role=server` control socket; phone connects; relay mints a
   `connectionId` and pushes `conn-open` down the control socket; daemon dials a *fresh* data
   socket for it; relay splices by tag. **Build v2 from day one.**

2. **The relay must be a dumb byte forwarder.** paseo's DO parses exactly three things: URL
   query params, its own control JSON, nothing else. Application frames are opaque and never
   stored. This is what makes E2EE meaningful and what keeps the relay cheap.

3. **Protocol-level WebSocket pings, never app-level JSON.** From
   `paseo/packages/server/src/server/relay-transport.ts:220`: *"Cloudflare's runtime auto-responds
   to protocol pings at the edge without waking the hibernated relay Durable Object, so this
   keepalive does not incur DO CPU billing."* This is a direct billing line item, and paseo keeps
   an e2e test asserting no JSON ping ever reaches the DO.

4. **Resumption belongs in the daemon, not the relay.** paseo keeps a 90s session grace window
   keyed by `(principalId, clientId)` in the daemon (`websocket-server.ts:493`); the relay holds
   only a 200-frame best-effort buffer. orca does the same via control-socket `generation` +
   `activeConnIds`/`pendingConns`. Do not build a durable replay log in the relay.

5. **paseo built the DO relay, shipped it, then moved production to Elixir on Fly.io** — the
   deployed Worker is now a 17-line pass-through (`cutover-proxy.ts`, gated on a
   `PASEO_RELAY_UPSTREAM` env var). The reason is not recorded in the repo. That escape-hatch
   pattern is itself worth stealing: it is a zero-downtime migration path that costs nothing to
   design in up front.

**Highest-value files to read before writing code:**
`orca/src/shared/mobile-relay-close-codes.ts` (typed close codes → prescribed recovery — copy
verbatim), `orca/src/main/runtime/relay/relay-control-protocol.ts`,
`orca/src/shared/mobile-e2ee-v2-framing.ts` + `mobile/src/transport/mobile-e2ee-v2-key-schedule.ts`,
`paseo/packages/relay/src/cloudflare-adapter.ts`, `paseo/SECURITY.md`.

---

## The AO-specific problem nobody else has

orca and paseo each relay **one WebSocket RPC protocol**. AO has **three transports on one port**:

- **REST** — ~130 routes under `/api/v1`, schema of record `backend/internal/httpd/apispec/openapi.yaml`
- **SSE** — `GET /api/v1/events` (CDC stream, `backend/internal/httpd/events.go`)
- **WebSocket** — `GET /mux` (terminal + session snapshots, `backend/internal/terminal/protocol.go`)

Re-specifying all three as relay messages would be an enormous, permanently-diverging surface.

**Decision: the relay carries HTTP, not AO semantics.** The daemon serves relay-delivered
requests by writing them at a **loopback socket it already runs**, so the existing router,
middleware and security gate execute unchanged, byte for byte.

```
phone fetch("/api/v1/sessions")
  → semantic frame {t:"req", id, method, path, headers, body}
  → sealed (XChaCha20-Poly1305) → binary WS frame
  → relay DO: splice by tag, never parses
  → daemon: open stream → dial 127.0.0.1:<bridge> → req.Write(conn)
                        → http.ReadResponse → stream body back as {t:"res-chunk"} frames
```

Why this shape:

- **Zero changes to REST, SSE, or the `/mux` protocol.** The 9,869-line OpenAPI contract and
  `backend/internal/terminal/protocol.go` are untouched.
- **SSE cannot buffer.** Each `ResponseWriter` flush becomes a `res-chunk` frame and leaves
  immediately. Defect (2) is fixed structurally, not worked around.
- **`req.Write` / `http.ReadResponse` are stdlib.** The daemon side is a byte pump, not an HTTP
  reimplementation. `/mux` needs no special case: after the `101`, pump raw bytes.
- **The security gate is identical by construction.** `lanControlBlock` (which 404s `/shutdown`,
  `/internal/`, `/api/v1/mobile`, `/api/v1/dev`, `/api/v1/browser`, `/api/v1/desktop`,
  `/api/v1/system/install`) and `authMiddleware` are transport-based today and unspoofable. Serving
  relay traffic through the same wrapped handler keeps that property. **Hard requirement: the relay
  must never be wired to the bare chi router.**
- Semantic framing rather than raw HTTP bytes on the wire, because the RN client is the binding
  constraint — Hermes has no HTTP parser and RN's WebSocket yields frames, not a byte stream. The
  phone implements a `fetch` shim and a `WebSocket` shim over the channel; every call site above
  them is unchanged.

**Consequence worth flagging:** ADR 0004's stated "intended fix" — moving conversation events off
SSE onto `/mux` — becomes **unnecessary**. The relay solves it generally, for every stream, not
just for chat.

**Second consequence — no LAN socket required.** Refactor `LANManager`
(`backend/internal/httpd/lan_listener.go`) so the same wrapped handler can bind `127.0.0.1` only.
The relay dials that. A user who wants remote access but not home-network access then has
**zero LAN attack surface**, which the current design cannot offer.

---

## Architecture

### Topology

```
                    wss://relay.aoagents.dev
  ┌──────────┐                                        ┌──────────┐
  │  daemon  │──── control socket (role=server) ──────│          │
  │   (Go)   │──── data socket per connectionId ──────│ DO per   │──── phone
  └──────────┘                                        │ hostId   │      (many)
       │                                              └──────────┘
       └── dials 127.0.0.1:<bridge> ── same handler as LAN listener
                                       (lanControlBlock + authMiddleware)
```

One **Durable Object per `relayHostId`**. `idFromName()` *is* the routing table — no director, no
presence table, no split-brain, no cross-instance forwarding. This is the single strongest reason
to start on Cloudflare. Namespace the DO name by protocol version so two versions can run side by
side without a flag day (paseo: `idFromName(\`relay-v${version}:${serverId}\`)`).

Socket tags carry all routing state, and live in the hibernation attachment so the DO can be
evicted between messages: `server-control`, `server:<connId>`, `client:<connId>`.

### Wire layers

| Layer | Content | Who can read it |
|---|---|---|
| WS frame (binary) | sealed envelope | — |
| Sealed envelope | 42-byte header + XChaCha20-Poly1305 ciphertext | phone + daemon only |
| Semantic frame | `req` / `res-head` / `res-chunk` / `res-end` / `ws-open` / `ws-data` / `ws-close` / `cancel` | phone + daemon only |
| HTTP | the existing `/api/v1` + `/mux` traffic, including its own `Authorization: Bearer` | phone + daemon only |

**Frames must be binary, never base64.** `/mux` already base64s PTY bytes inside its JSON
(`packages/mobile/lib/mux.ts`); base64-ing the envelope on top of that would stack a second 33%
tax on the firehose. paseo negotiates a `binaryCiphertext` capability precisely to undo this
retroactively and carries permanent COMPAT branches as a result — do it right the first time.

### E2EE (follow orca's v2; it is the strongest of the three)

- Daemon long-term X25519 keypair at `~/.ao/mobile/relay-key.json`, mode 0600, alongside the
  existing `identity.json`. `relayHostId = base64url(sha256(pubkey))[:16]` (orca's
  `deriveRelayHostId`).
- Per connection: phone generates a **fresh ephemeral** keypair, ECDH against the pubkey **pinned
  from the pairing QR**, HKDF-SHA256 with transcript-bound salt and info → `phoneToDaemonKey`,
  `daemonToPhoneKey`, `sessionId`.
- AEAD XChaCha20-Poly1305 (Go: `golang.org/x/crypto/chacha20poly1305`; RN: `@noble/ciphers`).
  **Deterministic counter nonces** with a strictly monotonic per-direction counter, and the header
  (sessionId, direction, kind, counter) replicated *inside* the ciphertext and compared after
  opening — so a swapped, replayed or reordered frame fails to open.
- This closes the gap paseo admits to in its own `SECURITY.md`: random nonces with no counters
  give **no intra-session replay protection**. AO should not ship with that hole.
- Two rules that are non-negotiable, both learned the hard way upstream:
  - Any plaintext-looking frame on an established channel is **fatal** — close, never downgrade.
  - A re-handshake with a *different* client key is rejected (constant-time compare, close 1008).
    This blocks a relay-initiated key-rotation attack.
- Buffer frames that arrive during async key derivation, or an early ciphertext frame gets misread
  as a second hello — a real bug paseo hit (`encrypted-channel.ts:265`).

### Credentials — two tiers, and this is where AO gains the most

Today: **one shared 8-char alphanumeric password**, no expiry, no scopes, no per-device
revocation; rotating it drops every phone (`backend/internal/mobilebridge/config.go`).

- **Outer** (relay sees it, cannot use it): opaque bearer authorizing a socket for a
  `relayHostId`. Short-lived single-use **invite token** from the QR (orca: 43-char base64url,
  ≤10 min), exchanged on first connect for a long-lived **resume credential** kept in SecureStore.
  Relay stores hashes only. Rotation is CAS'd on `expectedCurrentHash` with a grace window so a
  rotation interrupted by a disconnect is not lost.
- **Inner** (daemon-enforced, relay-blind): the existing `Authorization: Bearer <password>` rides
  *inside* the sealed envelope. **Zero daemon change on day one.**
- Then upgrade the inner tier to per-device tokens. `backend/internal/mobilebridge/pushdevices.go`
  (456 lines) **already maintains a device roster** with install IDs and mute state — that is the
  natural place to hang per-device credentials and revocation, and it means the phone-side roster
  UI already has a home.

### Reliability — the details that separate working from nearly-working

- **Protocol-level pings only.** Daemon: ping every 10s, terminate at 30s without a pong,
  `perMessageDeflate: false`. No JSON heartbeats, ever. Add a test asserting none reaches the DO.
- **Liveness keyed on any inbound frame** on the phone. shellular's comment is the reason:
  backgrounded mobile OSes kill TCP without ever delivering a close frame
  (`app/src/state/connection.ts`: ping 25s, liveness timeout 55s).
- **Half-open control sockets cannot be detected by send failure** — Cloudflare will accept writes
  on a dead socket. Copy paseo's ladder: at +10s with a client waiting and no server data socket,
  push a full `sync {connectionIds}`; at +15s, `close(1011, "Control unresponsive")` to force a
  daemon reconnect. And always send `sync` on control-socket connect so a reconnecting daemon
  re-attaches every live client.
- **Typed close codes with prescribed recovery.** `orca/src/shared/mobile-relay-close-codes.ts` is
  the single most copyable file in the research: `4401 BAD_CREDENTIAL → drop credential`,
  `4404 HOST_OFFLINE → retry with full jitter`, `4408 PEER_DROPPED → reconnect fresh E2EE`,
  `4409 WRONG_CELL → re-resolve`, `4429 LIMIT_EXCEEDED → backoff`, `4503 DRAINING → re-resolve`.
- **Relay buffering stays small and best-effort**: 200 frames, drop-oldest, flushed when the data
  socket opens, discarded when the last client for that `connectionId` closes.
- **Backoff**: daemon linear `min(30s, 1s × attempt)`; phone exponential
  `min(1.5s × 2^attempt, 30s)`.
- **Mobility without a director.** The daemon advertises its relay endpoint in
  `/api/v1/endpoints`, and the phone already refreshes and merges that list after every successful
  connect (`packages/mobile/lib/mergeEndpoints.ts`, `reRace.ts`). A relay-side `relay-moved`
  control message plus that existing refresh gives address mobility for free — no
  `/v1/assign` director round trip in v1. Keep orca's director shape in reserve for regionalization.

### Sizing

Design for the PTY stream, not the event stream: bidirectional, long-lived, small-frame,
latency-critical, with multi-hundred-KB repaint bursts on every terminal attach (AO does a full
tmux repaint per attach — `backend/internal/terminal/doc.go`). Measured baselines to beat: LAN
1 ms / 328 MB/s; quick tunnel 11–65 ms / 4.4 MB/s.

Frame cap **512 KiB** (DO limit is 1 MiB; leave headroom for the envelope). Chunk `res-chunk`
frames at 256 KiB. Export the encrypted-wire size math so callers can size payloads against the
cap without guessing — paseo has to invert this arithmetic in application code
(`checkout-git.ts:2051`) and it is ugly; provide the helper up front.

---

## Hosting: Cloudflare Workers + Durable Objects, with the escape hatch built in

**Recommended, with the reasoning stated because paseo's migration is a real counter-signal.**

For:
- The DO **is** the rendezvous primitive. `idFromName(relayHostId)` removes the entire class of
  problem that orca solves with a director + `assignmentEpoch` fencing and shellular solves with a
  central presence table. That is the majority of the complexity in both.
- Hibernation + edge-answered protocol pings make an idle daemon nearly free — the right cost
  shape for a desktop tool where most machines are idle most of the time.
- Anycast puts the relay near both peers. Scales to zero. ~600 lines of TS.
- Blast radius separate from AO Cloud, which matters (below).

Against, stated honestly:
- paseo built exactly this and left. Reason unrecorded; likely duration billing on long-held
  sockets, or the half-open control-socket awkwardness. **Measure DO duration cost against real
  idle daemons before committing past the pilot.**
- 1 MiB message cap shapes the framing (already accounted for).

**Build the cutover proxy on day one.** A `RELAY_UPSTREAM` env var that turns the Worker into a
pass-through to another origin (paseo's `cutover-proxy.ts` is 17 lines). Clients keep pointing at
`relay.aoagents.dev` forever; the backend behind it becomes a deployment detail. This makes the
DO-vs-stateful-fleet question **reversible**, which is the correct way to hold a decision with one
known defector.

**Do not fold this into AO Cloud.** `cloud/` is a multi-tenant control plane on ECS + RDS + WorkOS
that legitimately holds user code and conversation. The relay's entire value is holding *nothing*.
Different trust model, different blast radius, different deploy cadence. Identity can converge on
WorkOS later without merging the runtimes.

---

## Scope: fourth endpoint kind, then retire the tunnel

Advertise `relay` alongside the rest and let the existing race pick it. LAN keeps winning at home,
so most traffic never reaches AO infrastructure — which is also the honest privacy story.

One client change: the current preference order is `["lan","tailscale","tunnel","relay"]` with
relay **last** (`packages/mobile/lib/endpoints.ts`). It must become
`["lan","tailscale","relay","tunnel"]`. Older shipped builds will keep preferring the tunnel during
the overlap release, which is exactly the desired fallback behaviour.

Then delete `cloudflared` in a following release. What goes with it: the version check and managed
install, the stderr scraping in `tunnel_runner.go`, the hostname-rotation bug,
`packages/mobile/lib/staleTunnel.ts`, and **both polling stopgaps**
(`pollInterval.ts`, `chat/conversationPoll.ts`). Net code deletion.

---

## Build order

**P0 — shared contract.** Frame schema, envelope format, key schedule, close codes, and size math,
specified once in `contracts/` with cross-language test vectors. Go + TS implementations must agree
on the vectors before anything else is written.

**P1 — relay Worker.** `RelayDurableObject` with v2 topology, tag-based fan-out, hibernation
attachment, `sync`/nudge/reset ladder, 200-frame buffer, typed close codes, `RELAY_UPSTREAM`
cutover proxy. Tested under `vitest-pool-workers`.

**P2 — daemon side.** `backend/internal/mobilebridge/relay/`: keypair, control-socket client,
per-connection data sockets, E2EE channel, and the stream→loopback HTTP bridge. A
`ManagedRelay` supervisor mirroring `ManagedTunnel`
(`backend/internal/mobilebridge/managed_tunnel.go`) — same idempotent-by-port Start, same
non-blocking Stop, same `Endpoint()`/`Status()` surface, so `mobile_restore.go` and the settings
UI wire up identically. Add `KindRelay` to `endpoints.go`. Refactor `LANManager` to support a
loopback-only bind.

**P3 — phone side.** `fetch` shim and `WebSocket` shim over the channel in
`packages/mobile/lib/relay/`, so `api.ts`, `chat/sse.ts` and `mux.ts` are unchanged above the
transport. Credential storage and CAS rotation in SecureStore. Close-code recovery table.

**P4 — pairing.** Extend `PairingOffer` to v3 with
`relay: {relayHostId, relayUrl, daemonPublicKeyB64, inviteToken, inviteExpiresAt}` in
`packages/mobile/lib/pairingCode.ts` and `frontend/src/renderer/lib/pairing-payload.ts` (already
fragment-encoded — keep it that way; fragments never reach a web server). Desktop QR + settings UI.
Flip the preference order.

**P5 — cutover.** Ship advertising both. Measure. Retire `cloudflared` the release after.

---

## Verification

- **Cross-language vectors** (P0) — Go and TS produce byte-identical sealed frames.
- **Worker tests** — `vitest-pool-workers`: two clients on one `connectionId` never cross-talk
  (the v1 bug), buffer flush on late data socket, nudge-then-reset ladder, hibernation round-trip
  through `deserializeAttachment`, and **an assertion that no app-level JSON ping reaches the DO**.
- **Go tests** — `mobilebridge/relay` against a fake relay; `httptest` for the loopback bridge,
  asserting `lanControlBlock` still 404s `/shutdown` and `/api/v1/mobile` **over the relay path**.
  This is the security-critical test.
- **End-to-end** — real daemon + miniflare relay + a Node harness running the phone transport:
  a REST round trip, an SSE stream, and a `/mux` terminal attach with input echo.
- **Measurements that decide whether this shipped** (redo ADR 0004's methodology):
  - SSE first-byte latency, relay vs tunnel. Target: sub-second. Tunnel today: >60s.
  - Terminal keystroke RTT. Tunnel today: 11–65 ms.
  - Throughput on a full-screen TUI repaint burst. Tunnel today: 4.4 MB/s.
  - DO duration + request cost for one idle daemon over 24h — the number that decides Cloudflare
    vs a stateful fleet.
- **Manual** — pair over cellular with Wi-Fi off; kill the daemon mid-session and confirm the phone
  reconnects and resumes without a rescan (the failure `staleTunnel.ts` exists to apologize for).

---

## Assumptions

Stated because these are product calls that have not been confirmed:

1. **End-to-end encryption is the point.** The relay holds ciphertext only. This forecloses
   server-side features that need plaintext (relay-side fanout, notifications derived from relayed
   content). Reversing it later is a protocol break, so it is the one decision worth confirming
   before P0.
2. **No account required.** Pairing is a device keypair from the QR; the relay never holds a
   credential that grants access. Preserves today's scan-and-go onboarding. An optional WorkOS
   sign-in can later attach devices to an account for roster, revocation and quota **without
   changing the transport**, so this does not close that door.
3. **LAN and Tailscale stay.** Same-room usage should never route through AO infrastructure.
