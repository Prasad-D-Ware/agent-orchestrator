# Tailscale-scannable pairing QR

**Date:** 2026-08-07
**Status:** Approved, not yet implemented

## Problem

The Connect Mobile modal has a LAN/Tailscale segmented control, but the pairing
QR is identical in both modes. A user who selects "Tailscale" and scans the code
pairs their phone to the desktop's **LAN** address. Off Wi-Fi that address is
unreachable, and the failure message tells them to check that they are on the
same Wi-Fi — the opposite of what a Tailscale user is trying to do.

Three separate facts produce this:

1. `ConnectMobileSetup` (`frontend/src/renderer/components/settings/ConnectMobileSetup.tsx`)
   holds `mode` in local `useState` and renders nothing but two different
   instruction lists. It has no callback to its parent.
2. `ConnectMobileModal` always encodes `status.host`, which the toggle cannot
   influence.
3. `status.host` comes from `mobilebridge.AutopickLANIP()`, which excludes
   Tailscale twice: `skipInterface` drops `utun*`/`tun*` interfaces, and the
   address filter requires `ip4.IsPrivate()`, which is false for Tailscale's
   `100.64.0.0/10` CGNAT range.

Transport is not the problem. `LANManager.Start` binds `0.0.0.0`
(`backend/internal/httpd/lan_listener.go:131`), so the Tailscale interface is
already served, and the mobile app already accepts `100.x` and `*.ts.net` hosts.
Only discovery and pairing are missing.

### Secondary bug in scope

When the desktop has no LAN interface at all, `AutopickLANIP()` returns `""`.
The modal still renders a QR encoding `{"v":1,"host":"","port":3011,…}`. The
phone rejects an empty host (`packages/mobile/lib/pairing.ts:20`) and reports
"That QR code isn't an AO pairing code" — a nonsense error for a QR that AO
itself generated. The same guard fixes both cases.

## Decisions

**The toggle re-encodes the QR; the payload stays at `v: 1`.**

The alternative considered was a `hosts` array letting the phone try Tailscale
then LAN and self-heal across network changes. It was rejected as the primary
fix for a shipping reason: the mobile app releases through TestFlight/App Store,
so a payload change only reaches people who install a new build. A desktop-only
change works with every phone build already installed.

This is deliberately not foreclosed. `parsePairingPayload` checks `obj.v !== 1`
and reads only `host`/`port`/`password`, ignoring unknown keys — so a future
`hosts` array can be added alongside `host` under `v: 1` without breaking older
builds. Bumping to `v: 2` is what would break them, so we do not.

**Detection is an interface scan, not the `tailscale` CLI.**

`tailscale ip -4` is authoritative and could also yield the MagicDNS name via
`tailscale status --json`, but it fails silently when the binary is not on PATH
(App Store installs of Tailscale do not put it there), and it adds a subprocess
to a status endpoint the modal polls. The interface scan needs no subprocess, no
PATH, and does not care how Tailscale was installed. It yields the `100.x`
address rather than the MagicDNS name, which is fine: the address is stable and
the mobile app accepts it.

## Design

### Backend

`backend/internal/mobilebridge/netiface.go` gains a counterpart to
`AutopickLANIP`, following the same shape (an exported candidates function with
an injected `addrsOf`, plus a thin `Autopick*` wrapper over `net.Interfaces()`):

```go
// AutopickTailscaleIP returns the first Tailscale IPv4 address (100.64.0.0/10
// on a tunnel interface), or "" if Tailscale is not up on this machine.
func AutopickTailscaleIP() string
```

It must **not** route through `skipInterface`, which drops `utun*` — that is
exactly where Tailscale lives.

Two filters, both required:

- The interface name looks like a tunnel: `utun`, `tun`, or `tailscale` prefix.
- The address falls inside `100.64.0.0/10`.

The range check is the real discriminator. macOS hosts several `utun*`
interfaces (other VPNs, iCloud Private Relay) and only Tailscale's carries a
`100.x`. The name check is the safety net, so a genuinely carrier-NAT'd Ethernet
interface can never be mistaken for Tailscale.

`MobileStatusResponse` (`backend/internal/httpd/controllers/dto.go:1007`) gains:

```go
TailscaleHost string `json:"tailscaleHost"`
```

populated in `BridgeService.Status()` from `mobilebridge.AutopickTailscaleIP()`,
next to the existing `Host`.

`openapi.yaml` is generated from Go, not hand-edited
(`backend/internal/httpd/apispec/gen.go`). Regenerate both it and the TypeScript
schema with the documented single command (see AGENTS.md):

```bash
npm run api          # api:spec (go generate) then api:ts
```

Adding a field to an existing named type needs no registry change, but if the
hint state ever becomes its own named type, `schemaNames` in
`backend/internal/httpd/apispec/specgen/build.go` must gain an entry for it.

**No new exposure.** `/api/v1/mobile` is already 404'd on the LAN listener by
`lanControlBlock` (`backend/internal/httpd/lan_listener.go:55`), so neither the
Tailscale address nor the password is reachable from a phone. The field rides
the loopback-only control surface, same as `Host` and `Password` do today.

### Renderer

`ConnectMobileSetup` becomes controlled. `mode` and `onModeChange` move up to
`ConnectMobileModal`, which already owns the QR. The component keeps its
segmented control and step lists and drops its `useState`.

`ConnectMobileModal` derives the active host from the mode:

```tsx
const activeHost = mode === "tailscale" ? status.tailscaleHost : status.host;
```

and encodes `pairingPayload(activeHost, status.port, status.password)`.

When `activeHost` is empty, the modal renders a hint box in place of the QR
rather than a scannable code that would pair to an unreachable address:

- Tailscale mode: "Tailscale not detected on this computer. Install it and sign
  in, then reopen this window."
- LAN mode: "No local network address found. Connect to Wi-Fi or Ethernet, or
  use Tailscale."

The address line follows `activeHost` too, showing `—` rather than a bare
`:3011`.

`mode` resets to `"lan"` when the modal closes, so reopening is not affected by
a stale selection.

### Copy

`mobile.tailscale.step3` currently reads "In the app's Settings, enter that
address, port {{port}}, and the password below. Leave Use TLS off." That
instruction is now wrong — it becomes "Scan the code below."

The two new hint strings and the rewritten step need entries in **all seven**
non-English locales: `de`, `es`, `fr`, `ja`, `ko`, `pt-BR`, `zh-CN`.

The enforcing test is `frontend/src/renderer/i18n/instance.test.ts`, not
`renderer-coverage.test.ts` (which only bans hardcoded English JSX). Two
assertions apply:

- `"keeps locale catalogs covering every English key with non-empty values"`
  (line 149) — every locale must define every `en` key, non-empty.
- `"keeps interpolation variables aligned between locales"` (line 162) — the
  `{{var}}` set must match `en` exactly, per key.

The second constrains the rewrite: the current `mobile.tailscale.step3` carries
`{{port}}`, and the new "scan the code below" copy does not. Once `en` drops it,
every locale must drop it too. The `port` prop on `ConnectMobileSetup` then has
no remaining consumer and is removed, along with `port={status.port}` at its
single call site.

### Mobile

**No changes.** The payload stays `v: 1` and gains no keys; the host it carries
is a `100.x` instead of a `192.168.x`.

## Testing

- `netiface_test.go` — `AutopickTailscaleIP` table test using the existing
  injected `addrsOf`: `utun0` + `100.72.46.7` → picked; `utun1` + `10.0.0.1`
  (another VPN) → skipped; `en0` + `100.x` (carrier NAT) → skipped; `utun0`
  down → skipped; no interfaces → `""`.
- Controller test — `Status()` surfaces `tailscaleHost`, and the LAN listener
  still 404s `/api/v1/mobile/status` (existing assertion, must keep passing).
  `BridgeService.currentHost()` calls the real `AutopickLANIP()` today, which
  makes address output untestable; the two pickers become injectable
  `func() string` fields defaulting to the real ones, mirroring the `LookPath`
  injection already used in `session_manager` and `cli/doctor`.
- `ConnectMobileModal.test.tsx` — flipping the toggle changes the QR's `value`
  prop; an empty active host renders the hint and no QR; the address line tracks
  the mode.
- `ConnectMobileSetup.test.tsx` — updated for the controlled `mode` /
  `onModeChange` props.
- `renderer-coverage.test.ts` — passes with the new i18n keys.

## Out of scope

`packages/mobile/lib/connectionError.ts` tells a user whose connect failed to
check "is your phone on the same Wi-Fi?" — wrong advice for a `100.x` host,
which should instead point at Tailscale being down or the desktop being asleep.
It is a small pure-function change with an existing test file, but it needs an
app release to reach anyone, so it does not belong in a desktop-only PR. Track
it as a follow-up.

A `hosts` array for automatic Tailscale/LAN fallback is deferred, not rejected.
See the Decisions section for why the `v: 1` payload keeps that door open.
