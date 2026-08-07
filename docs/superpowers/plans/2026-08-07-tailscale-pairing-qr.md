# Tailscale-Scannable Pairing QR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Connect Mobile LAN/Tailscale toggle re-encode the pairing QR, so selecting "Tailscale" produces a scannable code carrying the desktop's `100.x` Tailscale address instead of its LAN address.

**Architecture:** The daemon gains a second address picker (`AutopickTailscaleIP`) that scans network interfaces for a `100.64.0.0/10` address on a tunnel interface, surfaced as a new `tailscaleHost` field on the existing mobile-status response. The renderer lifts the segmented control's `mode` state into the modal that owns the QR, so the QR encodes whichever host matches the selected mode — and renders an explanatory hint instead of a QR when that host is empty. The QR payload stays at `v: 1`, so no mobile-app change or release is required.

**Tech Stack:** Go 1.x (backend daemon, stdlib `net`), React 19 + TypeScript (Electron renderer), Radix UI `RadioGroup`, `qrcode.react`, `@tanstack/react-query`, i18next, Vitest + Testing Library, `go test`.

**Spec:** `docs/superpowers/specs/2026-08-07-tailscale-pairing-qr-design.md`

## Global Constraints

- **The QR payload stays at `v: 1`.** Do not bump the version and do not add keys to the payload. `packages/mobile/lib/pairing.ts:17` rejects anything where `obj.v !== 1`, so a bump breaks every already-installed phone build. Nothing under `packages/mobile/` is modified by this plan.
- **`openapi.yaml` and `frontend/src/api/schema.ts` are generated, never hand-edited.** After changing any Go DTO run `npm run api` from the repo root (it runs `api:spec` then `api:ts`). Commit the regenerated files.
- **Every new or changed `en` i18n key must be added to all seven other locales** — `de`, `es`, `fr`, `ja`, `ko`, `pt-BR`, `zh-CN` — with non-empty values. Enforced by `frontend/src/renderer/i18n/instance.test.ts:149`.
- **`{{interpolation}}` variables must match `en` exactly in every locale**, per key. Enforced by `frontend/src/renderer/i18n/instance.test.ts:162`. Dropping `{{port}}` from `en` means dropping it from all seven.
- **No hardcoded English in renderer JSX.** All user-visible text goes through `t(...)`. Enforced by `frontend/src/renderer/i18n/renderer-coverage.test.ts`. The one exemption relevant here is already allowlisted: `"tailscale ip -4"` in `ConnectMobileSetup.tsx`.
- **`AutopickTailscaleIP` must not route through `skipInterface`.** That helper drops `utun*`/`tun*`, which is exactly where Tailscale lives.
- **Do not weaken `lanControlBlock`** (`backend/internal/httpd/lan_listener.go:55`). `/api/v1/mobile` must stay 404 on the LAN listener so the address and password never reach a phone.
- Commit messages follow Conventional Commits. Do not add `Co-Authored-By: Claude` or `Claude-Session:` trailers.

## File Structure

**Backend**

- `backend/internal/mobilebridge/netiface.go` — modify. Add `TailscaleIPv4Candidates` + `AutopickTailscaleIP` alongside the existing LAN pair, over a shared private walker.
- `backend/internal/mobilebridge/netiface_test.go` — modify. Add the Tailscale table test.
- `backend/internal/httpd/controllers/dto.go:1007` — modify. Add `TailscaleHost` to `MobileStatusResponse`.
- `backend/internal/httpd/controllers/mobile.go` — modify. Injectable pickers; `Status()` populates `TailscaleHost`.
- `backend/internal/httpd/controllers/mobile_test.go` — modify. Assert `Status()` surfaces both hosts.
- `backend/internal/httpd/apispec/openapi.yaml` — regenerated.
- `frontend/src/api/schema.ts` — regenerated.

**Renderer**

- `frontend/src/renderer/i18n/en.json` + 7 locale files — modify. Reword `mobile.tailscale.step3`; add `mobile.noTailscaleHost`, `mobile.noPairingHost`.
- `frontend/src/renderer/components/settings/ConnectMobileSetup.tsx` — modify. Becomes a controlled component: `mode`/`onModeChange` in, local `useState` and now-unused `port` prop out.
- `frontend/src/renderer/components/settings/ConnectMobileSetup.test.tsx` — modify. Drive the controlled props.
- `frontend/src/renderer/components/ConnectMobileModal.tsx` — modify. Owns `mode`, derives `activeHost`, renders QR-or-hint.
- `frontend/src/renderer/components/ConnectMobileModal.test.tsx` — modify. Add render tests for mode-driven QR and the empty-host hint.

---

### Task 1: Tailscale address picker

**Files:**
- Modify: `backend/internal/mobilebridge/netiface.go`
- Test: `backend/internal/mobilebridge/netiface_test.go`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: `mobilebridge.AutopickTailscaleIP() string` and `mobilebridge.TailscaleIPv4Candidates(ifaces []net.Interface, addrsOf func(net.Interface) ([]net.Addr, error)) []string`. Task 2 calls `AutopickTailscaleIP`. The existing `PrivateIPv4Candidates` and `AutopickLANIP` keep their current exported signatures and behavior — callers elsewhere depend on them.

**Background:** Tailscale assigns each machine an address in the `100.64.0.0/10` CGNAT range on a tunnel interface (`utun0` on macOS, `tailscale0` on Linux). Two filters are needed, both required. The range check is the real discriminator, because macOS hosts several `utun*` interfaces (other VPNs, iCloud Private Relay) and only Tailscale's carries a `100.x`. The interface-name check is the safety net, so a genuinely carrier-NAT'd Ethernet interface can never be mistaken for Tailscale. Note `100.64.0.0/10` is *not* RFC1918, so Go's `ip.IsPrivate()` returns false for it — that is precisely why the existing LAN picker excludes it.

- [ ] **Step 1: Write the failing test**

Append to `backend/internal/mobilebridge/netiface_test.go`:

```go
func TestTailscaleIPv4Candidates(t *testing.T) {
	ifaces := []net.Interface{
		{Index: 1, Name: "lo0", Flags: net.FlagUp | net.FlagLoopback}, // loopback — skip
		{Index: 2, Name: "en0", Flags: net.FlagUp},                    // carrier NAT — skip
		{Index: 3, Name: "utun1", Flags: net.FlagUp},                  // other VPN — skip
		{Index: 4, Name: "utun0", Flags: net.FlagUp},                  // Tailscale — keep
		{Index: 5, Name: "utun9", Flags: 0},                           // down — skip
	}
	addrs := map[string][]net.Addr{
		"lo0":   {cidr("127.0.0.1/8")},
		"en0":   {cidr("100.90.1.1/24")},
		"utun1": {cidr("10.9.9.9/24")},
		"utun0": {cidr("100.72.46.7/32"), cidr("fd7a:115c:a1e0::1/128")},
		"utun9": {cidr("100.80.0.1/32")},
	}
	got := TailscaleIPv4Candidates(ifaces, func(i net.Interface) ([]net.Addr, error) {
		return addrs[i.Name], nil
	})
	if len(got) != 1 || got[0] != "100.72.46.7" {
		t.Fatalf("got %v want [100.72.46.7]", got)
	}
}

func TestTailscaleIPv4CandidatesEmptyWhenTailscaleDown(t *testing.T) {
	ifaces := []net.Interface{{Index: 1, Name: "en0", Flags: net.FlagUp}}
	addrs := map[string][]net.Addr{"en0": {cidr("192.168.1.42/24")}}
	got := TailscaleIPv4Candidates(ifaces, func(i net.Interface) ([]net.Addr, error) {
		return addrs[i.Name], nil
	})
	if len(got) != 0 {
		t.Fatalf("got %v want []", got)
	}
}

// The LAN picker must keep ignoring Tailscale, or enabling Tailscale would
// silently change which address the LAN tab of the pairing modal advertises.
func TestPrivateIPv4CandidatesStillIgnoresTailscale(t *testing.T) {
	ifaces := []net.Interface{
		{Index: 1, Name: "en0", Flags: net.FlagUp},
		{Index: 2, Name: "utun0", Flags: net.FlagUp},
	}
	addrs := map[string][]net.Addr{
		"en0":   {cidr("192.168.1.42/24")},
		"utun0": {cidr("100.72.46.7/32")},
	}
	got := PrivateIPv4Candidates(ifaces, func(i net.Interface) ([]net.Addr, error) {
		return addrs[i.Name], nil
	})
	if len(got) != 1 || got[0] != "192.168.1.42" {
		t.Fatalf("got %v want [192.168.1.42]", got)
	}
}
```

The existing `cidr` helper at the bottom of the file is reused as-is — do not redefine it.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/mobilebridge/ -run TestTailscale -v`
Expected: FAIL — `undefined: TailscaleIPv4Candidates`.

- [ ] **Step 3: Write the implementation**

In `backend/internal/mobilebridge/netiface.go`, add the CGNAT range and the interface predicate near `skipInterface`:

```go
// tailscaleCGNAT is the 100.64.0.0/10 range Tailscale assigns to nodes. It is
// deliberately NOT covered by net.IP.IsPrivate (which is RFC1918 only), which
// is why PrivateIPv4Candidates never returns a Tailscale address.
var tailscaleCGNAT = &net.IPNet{IP: net.IPv4(100, 64, 0, 0), Mask: net.CIDRMask(10, 32)}

// isTunnelInterface reports whether the interface is an up, non-loopback tunnel
// device of the kind Tailscale binds to. Deliberately NOT expressed via
// skipInterface, which drops utun*/tun* — exactly where Tailscale lives.
func isTunnelInterface(i net.Interface) bool {
	if i.Flags&net.FlagUp == 0 || i.Flags&net.FlagLoopback != 0 {
		return false
	}
	n := strings.ToLower(i.Name)
	return strings.HasPrefix(n, "utun") || strings.HasPrefix(n, "tun") || strings.HasPrefix(n, "tailscale")
}
```

Extract the address walk shared by both pickers, so the IPv4/loopback/link-local
handling exists once:

```go
// ipv4Candidates walks ifaces, keeping the IPv4 addresses of interfaces that
// satisfy keepIface whose IPs satisfy keepIP. addrsOf is injected so callers
// (and tests) can supply the per-interface address lookup.
func ipv4Candidates(
	ifaces []net.Interface,
	addrsOf func(net.Interface) ([]net.Addr, error),
	keepIface func(net.Interface) bool,
	keepIP func(net.IP) bool,
) []string {
	var out []string
	for _, i := range ifaces {
		if !keepIface(i) {
			continue
		}
		addrs, err := addrsOf(i)
		if err != nil {
			continue
		}
		for _, a := range addrs {
			var ip net.IP
			switch v := a.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			ip4 := ip.To4()
			if ip4 == nil || ip.IsLoopback() || ip.IsLinkLocalUnicast() {
				continue
			}
			if keepIP(ip4) {
				out = append(out, ip4.String())
			}
		}
	}
	return out
}
```

Rewrite the existing `PrivateIPv4Candidates` body over it, keeping its doc
comment and exported signature unchanged:

```go
func PrivateIPv4Candidates(ifaces []net.Interface, addrsOf func(net.Interface) ([]net.Addr, error)) []string {
	return ipv4Candidates(ifaces, addrsOf,
		func(i net.Interface) bool { return !skipInterface(i) },
		func(ip net.IP) bool { return ip.IsPrivate() },
	)
}
```

Add the Tailscale pair:

```go
// TailscaleIPv4Candidates returns the Tailscale IPv4 addresses (100.64.0.0/10
// on a tunnel interface) of the given interfaces. Both filters are required:
// the range check is the real discriminator, since a machine may have several
// utun* interfaces and only Tailscale's carries a 100.x; the interface check
// keeps a genuinely carrier-NAT'd Ethernet interface from being mistaken for
// Tailscale.
func TailscaleIPv4Candidates(ifaces []net.Interface, addrsOf func(net.Interface) ([]net.Addr, error)) []string {
	return ipv4Candidates(ifaces, addrsOf, isTunnelInterface, tailscaleCGNAT.Contains)
}

// AutopickTailscaleIP returns this machine's Tailscale IPv4 address, or "" when
// Tailscale is not installed, not running, or logged out. Best-effort, and the
// caller must treat "" as "no Tailscale address to advertise" rather than an error.
func AutopickTailscaleIP() string {
	ifaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	c := TailscaleIPv4Candidates(ifaces, func(i net.Interface) ([]net.Addr, error) {
		return i.Addrs()
	})
	if len(c) == 0 {
		return ""
	}
	return c[0]
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/mobilebridge/ -v`
Expected: PASS, including the pre-existing `TestPrivateIPv4Candidates`.

- [ ] **Step 5: Sanity-check against the real machine**

Run: `cd backend && go run ./cmd/... 2>/dev/null; ifconfig | grep -A1 utun | grep "inet 100\."`
Expected: prints a `100.x` address if Tailscale is up on this machine (on the dev machine used to write the spec: `inet 100.72.46.7`). If Tailscale is not running here, that is fine — the unit tests are authoritative and this step is informational only.

- [ ] **Step 6: Commit**

```bash
git add backend/internal/mobilebridge/netiface.go backend/internal/mobilebridge/netiface_test.go
git commit -m "feat(mobilebridge): detect the machine's Tailscale IPv4 address"
```

---

### Task 2: Surface `tailscaleHost` on the mobile status API

**Files:**
- Modify: `backend/internal/httpd/controllers/dto.go:1007-1013`
- Modify: `backend/internal/httpd/controllers/mobile.go:82-108`
- Test: `backend/internal/httpd/controllers/mobile_test.go`
- Regenerated: `backend/internal/httpd/apispec/openapi.yaml`, `frontend/src/api/schema.ts`

**Interfaces:**
- Consumes: `mobilebridge.AutopickTailscaleIP() string` from Task 1.
- Produces: `MobileStatusResponse.TailscaleHost string` with JSON key `tailscaleHost`, present on `GET /api/v1/mobile/status`, `POST /api/v1/mobile/enable`, `POST .../disable`, `POST .../regenerate`. Task 4 reads it as `status.tailscaleHost` in the renderer. Also produces the injectable fields `BridgeService.PickLANHost` and `BridgeService.PickTailscaleHost`, both `func() string`.

**Background:** `BridgeService.currentHost()` currently calls `mobilebridge.AutopickLANIP()` directly, so its output depends on the host machine's real network interfaces and cannot be asserted in a test. Making both pickers injectable fields that default to the real functions mirrors the `LookPath func(string) (string, error)` injection already used in `backend/internal/session_manager/manager.go:402` and `backend/internal/cli/doctor.go`.

- [ ] **Step 1: Write the failing test**

Append to `backend/internal/httpd/controllers/mobile_test.go`:

```go
// Status must advertise both addresses so the renderer's LAN/Tailscale toggle
// can re-encode the pairing QR without a second round trip.
func TestMobileStatusSurfacesBothHosts(t *testing.T) {
	lan := &fakeLAN{running: true}
	b := &BridgeService{
		LAN:               lan,
		ConfigPath:        filepath.Join(t.TempDir(), "mobile", "config.json"),
		DefaultPort:       3011,
		PickLANHost:       func() string { return "192.168.1.42" },
		PickTailscaleHost: func() string { return "100.72.46.7" },
	}
	if _, err := b.Enable(); err != nil {
		t.Fatalf("enable: %v", err)
	}

	got := b.Status()
	if got.Host != "192.168.1.42" {
		t.Errorf("Host = %q want 192.168.1.42", got.Host)
	}
	if got.TailscaleHost != "100.72.46.7" {
		t.Errorf("TailscaleHost = %q want 100.72.46.7", got.TailscaleHost)
	}
}

// An absent Tailscale install is an empty string, not an error: the renderer
// uses "" to decide to show a hint instead of an unscannable QR.
func TestMobileStatusTailscaleHostEmptyWhenAbsent(t *testing.T) {
	b := &BridgeService{
		LAN:               &fakeLAN{running: true},
		ConfigPath:        filepath.Join(t.TempDir(), "mobile", "config.json"),
		DefaultPort:       3011,
		PickLANHost:       func() string { return "192.168.1.42" },
		PickTailscaleHost: func() string { return "" },
	}
	if _, err := b.Enable(); err != nil {
		t.Fatalf("enable: %v", err)
	}
	if got := b.Status().TailscaleHost; got != "" {
		t.Errorf("TailscaleHost = %q want empty", got)
	}
}

// Unset pickers must fall back to the real autopickers rather than panicking on
// a nil func — production wiring in daemon.go leaves them unset.
func TestMobileStatusHostPickersDefaultWhenUnset(t *testing.T) {
	b := &BridgeService{
		LAN:         &fakeLAN{running: true},
		ConfigPath:  filepath.Join(t.TempDir(), "mobile", "config.json"),
		DefaultPort: 3011,
	}
	_ = b.Status() // must not panic
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && go test ./internal/httpd/controllers/ -run TestMobileStatus -v`
Expected: FAIL — `unknown field PickLANHost in struct literal` and `got.TailscaleHost undefined`.

- [ ] **Step 3: Add the DTO field**

In `backend/internal/httpd/controllers/dto.go`, change `MobileStatusResponse` (currently lines 1007-1013) to:

```go
type MobileStatusResponse struct {
	Enabled bool   `json:"enabled"`
	Host    string `json:"host"`
	// TailscaleHost is this machine's 100.64.0.0/10 Tailscale address, or "" when
	// Tailscale is not up. The renderer encodes it into the pairing QR when the
	// user selects the Tailscale tab, and shows a hint instead when it is empty.
	TailscaleHost string `json:"tailscaleHost"`
	Port          int    `json:"port"`
	Password      string `json:"password"`
	Warning       string `json:"warning"`
}
```

- [ ] **Step 4: Make the pickers injectable and populate the field**

In `backend/internal/httpd/controllers/mobile.go`, extend the `BridgeService` struct (currently lines 82-86):

```go
type BridgeService struct {
	LAN         LANController
	ConfigPath  string
	DefaultPort int
	// PickLANHost and PickTailscaleHost resolve the advertised addresses. Both
	// are nil in production (daemon.go) and fall back to the real autopickers;
	// tests inject stubs so status output does not depend on the host machine's
	// real network interfaces.
	PickLANHost       func() string
	PickTailscaleHost func() string
}
```

Replace `currentHost` (line 88) with two accessors:

```go
func (b *BridgeService) currentHost() string {
	if b.PickLANHost != nil {
		return b.PickLANHost()
	}
	return mobilebridge.AutopickLANIP()
}

func (b *BridgeService) currentTailscaleHost() string {
	if b.PickTailscaleHost != nil {
		return b.PickTailscaleHost()
	}
	return mobilebridge.AutopickTailscaleIP()
}
```

In `Status()`, add the field to the response literal (currently lines 95-100):

```go
	res := MobileStatusResponse{
		Enabled:       enabled,
		Host:          b.currentHost(),
		TailscaleHost: b.currentTailscaleHost(),
		Port:          b.LAN.BoundPort(),
		Warning:       mobileUnencryptedWarning,
	}
```

Leave the `if enabled { res.Password = st.Password }` guard below it untouched.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd backend && go test ./internal/httpd/... -v`
Expected: PASS. The existing `TestMobileEnableRollsBackListenerWhenSaveFails` and the LAN-listener 404 assertions must still pass — if a test asserts an exact `MobileStatusResponse` value, update it to include the new zero-valued field rather than removing the assertion.

- [ ] **Step 6: Regenerate the API artifacts**

Run from the repo root:

```bash
npm run api
```

Expected: `backend/internal/httpd/apispec/openapi.yaml` gains `tailscaleHost` under the `MobileStatusResponse` schema, and `frontend/src/api/schema.ts` gains it on the corresponding TypeScript type. Verify:

```bash
grep -A 12 "MobileStatusResponse:" backend/internal/httpd/apispec/openapi.yaml | grep tailscaleHost
grep -n "tailscaleHost" frontend/src/api/schema.ts
```

Both must print a match. Do not hand-edit either file — if `tailscaleHost` is missing, the Go struct tag is wrong.

- [ ] **Step 7: Verify the spec-parity test still passes**

Run: `cd backend && go test ./internal/httpd/apispec/...`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/internal/httpd/controllers/dto.go \
        backend/internal/httpd/controllers/mobile.go \
        backend/internal/httpd/controllers/mobile_test.go \
        backend/internal/httpd/apispec/openapi.yaml \
        frontend/src/api/schema.ts
git commit -m "feat(mobile): advertise the Tailscale address on mobile status"
```

---

### Task 3: Pairing-hint and Tailscale copy across all locales

**Files:**
- Modify: `frontend/src/renderer/i18n/en.json`
- Modify: `frontend/src/renderer/i18n/de.json`, `es.json`, `fr.json`, `ja.json`, `ko.json`, `pt-BR.json`, `zh-CN.json`
- Modify: `frontend/src/renderer/components/settings/ConnectMobileSetup.tsx:60` (call site only)
- Test: `frontend/src/renderer/i18n/instance.test.ts` (existing, no edits — it must pass)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: three i18n keys used by Task 4 — `mobile.tailscale.step3` (reworded, **no interpolation variables**), `mobile.noTailscaleHost`, and `mobile.noPairingHost`.

**Background:** `mobile.tailscale.step3` currently instructs the user to type the address into the app's Settings. Once the QR carries the Tailscale address that instruction is wrong. The rewritten copy has no `{{port}}`, and `instance.test.ts:162` requires the interpolation set to match `en` in every locale — so `{{port}}` must be removed from all eight files in the same commit, or the test fails.

Keys are stored in each file in alphabetical order. Insert the two new keys so that order is preserved: `mobile.noPairingHost` and `mobile.noTailscaleHost` sort between `mobile.loadFailed` and `mobile.password`.

- [ ] **Step 1: Run the i18n tests to confirm a green baseline**

Run: `cd frontend && npx vitest run src/renderer/i18n/instance.test.ts`
Expected: PASS. If it already fails, stop and report — this task's verification depends on a clean baseline.

- [ ] **Step 2: Edit `en.json`**

Replace the existing `mobile.tailscale.step3` line and add the two new keys:

```json
	"mobile.noPairingHost": "No network address found for this computer. Connect to Wi-Fi or Ethernet, or set up Tailscale.",
	"mobile.noTailscaleHost": "Tailscale isn't running on this computer. Install it and sign in, then reopen this window.",
	"mobile.tailscale.step3": "Scan the code below — your Tailscale address and password fill in automatically.",
```

- [ ] **Step 3: Edit the seven other locale files**

`zh-CN.json`:
```json
	"mobile.noPairingHost": "未找到此电脑的网络地址。请连接 Wi-Fi 或以太网，或设置 Tailscale。",
	"mobile.noTailscaleHost": "此电脑未运行 Tailscale。请安装并登录后重新打开此窗口。",
	"mobile.tailscale.step3": "扫描下方二维码 — Tailscale 地址和密码会自动填入。",
```

`de.json`:
```json
	"mobile.noPairingHost": "Keine Netzwerkadresse für diesen Computer gefunden. Stellen Sie eine WLAN- oder Ethernet-Verbindung her oder richten Sie Tailscale ein.",
	"mobile.noTailscaleHost": "Tailscale läuft auf diesem Computer nicht. Installieren Sie es, melden Sie sich an und öffnen Sie dieses Fenster erneut.",
	"mobile.tailscale.step3": "Scannen Sie den Code unten — Ihre Tailscale-Adresse und das Passwort werden automatisch ausgefüllt.",
```

`es.json`:
```json
	"mobile.noPairingHost": "No se encontró ninguna dirección de red para este ordenador. Conéctate a Wi-Fi o Ethernet, o configura Tailscale.",
	"mobile.noTailscaleHost": "Tailscale no se está ejecutando en este ordenador. Instálalo, inicia sesión y vuelve a abrir esta ventana.",
	"mobile.tailscale.step3": "Escanea el código de abajo: tu dirección de Tailscale y la contraseña se rellenan automáticamente.",
```

`fr.json`:
```json
	"mobile.noPairingHost": "Aucune adresse réseau trouvée pour cet ordinateur. Connectez-vous au Wi-Fi ou à Ethernet, ou configurez Tailscale.",
	"mobile.noTailscaleHost": "Tailscale n'est pas en cours d'exécution sur cet ordinateur. Installez-le, connectez-vous, puis rouvrez cette fenêtre.",
	"mobile.tailscale.step3": "Scannez le code ci-dessous — votre adresse Tailscale et le mot de passe se remplissent automatiquement.",
```

`ja.json`:
```json
	"mobile.noPairingHost": "このコンピュータのネットワークアドレスが見つかりません。Wi-Fi またはイーサネットに接続するか、Tailscale を設定してください。",
	"mobile.noTailscaleHost": "このコンピュータで Tailscale が実行されていません。インストールしてサインインしてから、このウィンドウを開き直してください。",
	"mobile.tailscale.step3": "下のコードをスキャンすると、Tailscale アドレスとパスワードが自動入力されます。",
```

`ko.json`:
```json
	"mobile.noPairingHost": "이 컴퓨터의 네트워크 주소를 찾을 수 없습니다. Wi-Fi 또는 이더넷에 연결하거나 Tailscale을 설정하세요.",
	"mobile.noTailscaleHost": "이 컴퓨터에서 Tailscale이 실행되고 있지 않습니다. 설치하고 로그인한 뒤 이 창을 다시 여세요.",
	"mobile.tailscale.step3": "아래 코드를 스캔하면 Tailscale 주소와 비밀번호가 자동으로 입력됩니다.",
```

`pt-BR.json`:
```json
	"mobile.noPairingHost": "Nenhum endereço de rede encontrado para este computador. Conecte-se ao Wi-Fi ou Ethernet, ou configure o Tailscale.",
	"mobile.noTailscaleHost": "O Tailscale não está em execução neste computador. Instale-o, faça login e reabra esta janela.",
	"mobile.tailscale.step3": "Escaneie o código abaixo — seu endereço Tailscale e a senha são preenchidos automaticamente.",
```

- [ ] **Step 4: Update the one call site so the tree stays green**

In `frontend/src/renderer/components/settings/ConnectMobileSetup.tsx`, line 60 currently reads:

```tsx
<li>{t("mobile.tailscale.step3", { port })}</li>
```

The key no longer interpolates anything, so drop the argument:

```tsx
<li>{t("mobile.tailscale.step3")}</li>
```

Leave the `port` prop itself in place for now — Task 4 removes it along with the rest of the component's reshaping.

- [ ] **Step 5: Run the i18n tests to verify they pass**

Run: `cd frontend && npx vitest run src/renderer/i18n/`
Expected: PASS — specifically `keeps locale catalogs covering every English key with non-empty values` and `keeps interpolation variables aligned between locales`. A failure naming `{{port}}` means a locale file still carries the old string.

- [ ] **Step 6: Typecheck**

Run: `cd frontend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. An error on `mobile.tailscale.step3` means Step 4 was missed.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderer/i18n/*.json frontend/src/renderer/components/settings/ConnectMobileSetup.tsx
git commit -m "i18n(mobile): reword Tailscale pairing step and add missing-host hints"
```

---

### Task 4: Drive the QR from the LAN/Tailscale toggle

**Files:**
- Modify: `frontend/src/renderer/components/settings/ConnectMobileSetup.tsx`
- Modify: `frontend/src/renderer/components/ConnectMobileModal.tsx:20-26, 199-259`
- Test: `frontend/src/renderer/components/settings/ConnectMobileSetup.test.tsx`
- Test: `frontend/src/renderer/components/ConnectMobileModal.test.tsx`

**Interfaces:**
- Consumes: `status.tailscaleHost` from Task 2; `mobile.noTailscaleHost` / `mobile.noPairingHost` / reworded `mobile.tailscale.step3` from Task 3.
- Produces: the user-visible behavior. `ConnectMobileSetup`'s exported props become `{ mode: SetupMode; onModeChange: (mode: SetupMode) => void; enabled: boolean }` — the `port` prop is removed. `SetupMode` (`"lan" | "tailscale"`) is exported from `ConnectMobileSetup.tsx` so the modal can type its state. `pairingPayload` keeps its current exported signature `(host: string, port: number, password: string) => string`.

**Background:** `ConnectMobileSetup` holds `mode` in local `useState` (line 24) and has no callback out, so the modal cannot see it — which is why the QR never changes today. Lifting the state to `ConnectMobileModal`, which already owns the QR, is the whole fix. The empty-host guard closes a second bug: when `AutopickLANIP()` finds nothing, today's modal renders a QR encoding `{"v":1,"host":"",...}`, which the phone rejects with "That QR code isn't an AO pairing code."

- [ ] **Step 1: Write the failing tests**

Replace the whole of `frontend/src/renderer/components/settings/ConnectMobileSetup.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";
import { ConnectMobileSetup } from "./ConnectMobileSetup";

test("renders the LAN steps when the mode is lan", () => {
	render(<ConnectMobileSetup mode="lan" onModeChange={vi.fn()} enabled={true} />);
	expect(screen.getByText(/same Wi-Fi as this computer/i)).toBeInTheDocument();
	expect(screen.queryByText(/tailscale ip -4/i)).not.toBeInTheDocument();
});

test("renders the Tailscale steps when the mode is tailscale", () => {
	render(<ConnectMobileSetup mode="tailscale" onModeChange={vi.fn()} enabled={true} />);
	expect(screen.getByText(/tailscale ip -4/i)).toBeInTheDocument();
	expect(screen.getByText(/scan the code below/i)).toBeInTheDocument();
});

test("reports the selected mode to its parent rather than keeping it locally", async () => {
	const onModeChange = vi.fn();
	render(<ConnectMobileSetup mode="lan" onModeChange={onModeChange} enabled={true} />);
	await userEvent.click(screen.getByRole("radio", { name: "Tailscale" }));
	expect(onModeChange).toHaveBeenCalledWith("tailscale");
});

test("segments leave the tab order while the bridge is disabled", () => {
	render(<ConnectMobileSetup mode="lan" onModeChange={vi.fn()} enabled={false} />);
	expect(screen.getByRole("radio", { name: "LAN" })).toHaveAttribute("tabindex", "-1");
});
```

Then replace the whole of `frontend/src/renderer/components/ConnectMobileModal.test.tsx`. It keeps the existing payload unit test and adds render tests, following the mocking pattern already used in `ConnectMobileModal.telemetry.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, test, vi } from "vitest";

// vi.mock is hoisted above module-level consts, so the shared double has to be
// created inside vi.hoisted to exist by the time the factory runs.
const { mobileStatus } = vi.hoisted(() => ({
	mobileStatus: {
		enabled: true,
		host: "192.168.1.42",
		tailscaleHost: "100.72.46.7",
		port: 3011,
		password: "fake-password-for-testing",
		warning: "",
	},
}));

vi.mock("../lib/telemetry", () => ({ captureRendererEvent: vi.fn() }));
vi.mock("../lib/api-client", () => ({
	apiClient: {
		GET: async () => ({ data: mobileStatus, error: undefined }),
		POST: vi.fn(async () => ({ data: {}, error: undefined })),
	},
	apiErrorMessage: () => "failed",
}));

import { ConnectMobileModal, pairingPayload } from "./ConnectMobileModal";

function renderModal() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<QueryClientProvider client={client}>
			<ConnectMobileModal open={true} onOpenChange={vi.fn()} />
		</QueryClientProvider>,
	);
}

// The QR is an <svg>, so read the payload off the value the component encodes
// rather than the DOM: qrcode.react renders paths, not text.
function qrPayload(): string | null {
	const svg = document.querySelector("svg[data-qr-value]");
	return svg?.getAttribute("data-qr-value") ?? null;
}

beforeEach(() => {
	mobileStatus.enabled = true;
	mobileStatus.host = "192.168.1.42";
	mobileStatus.tailscaleHost = "100.72.46.7";
});

test("QR payload carries host, port, and password for one-scan connect", () => {
	const s = pairingPayload("192.168.1.42", 3011, "fake-password-for-testing");
	expect(JSON.parse(s)).toEqual({ v: 1, host: "192.168.1.42", port: 3011, password: "fake-password-for-testing" });
});

test("encodes the LAN address by default", async () => {
	renderModal();
	await waitFor(() => expect(qrPayload()).not.toBeNull());
	expect(JSON.parse(qrPayload()!).host).toBe("192.168.1.42");
});

test("re-encodes the QR with the Tailscale address when that mode is selected", async () => {
	renderModal();
	await waitFor(() => expect(qrPayload()).not.toBeNull());

	await userEvent.click(screen.getByRole("radio", { name: "Tailscale" }));

	await waitFor(() => expect(JSON.parse(qrPayload()!).host).toBe("100.72.46.7"));
	// The password and port are unchanged — only the address differs.
	expect(JSON.parse(qrPayload()!)).toEqual({
		v: 1,
		host: "100.72.46.7",
		port: 3011,
		password: "fake-password-for-testing",
	});
});

test("shows a hint instead of a QR when Tailscale is not running", async () => {
	mobileStatus.tailscaleHost = "";
	renderModal();
	await waitFor(() => expect(qrPayload()).not.toBeNull());

	await userEvent.click(screen.getByRole("radio", { name: "Tailscale" }));

	await waitFor(() => expect(screen.getByText(/Tailscale isn't running/i)).toBeInTheDocument());
	expect(qrPayload()).toBeNull();
});

// Regression: an empty host used to encode {"v":1,"host":"",...}, which the
// phone rejects as "not an AO pairing code" — an incoherent error for a QR AO
// generated itself.
test("shows a hint instead of an unscannable QR when there is no LAN address", async () => {
	mobileStatus.host = "";
	renderModal();
	await waitFor(() => expect(screen.getByText(/No network address found/i)).toBeInTheDocument());
	expect(qrPayload()).toBeNull();
});

test("the address line follows the selected mode", async () => {
	renderModal();
	const address = await screen.findByTestId("mobile-pairing-address");
	expect(within(address).getByText("192.168.1.42:3011")).toBeInTheDocument();

	await userEvent.click(screen.getByRole("radio", { name: "Tailscale" }));
	await waitFor(() => expect(within(address).getByText("100.72.46.7:3011")).toBeInTheDocument());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npx vitest run src/renderer/components/ConnectMobileModal.test.tsx src/renderer/components/settings/ConnectMobileSetup.test.tsx`
Expected: FAIL — `ConnectMobileSetup` does not accept `mode`/`onModeChange`, there is no `data-qr-value` attribute, and no `mobile-pairing-address` test id.

- [ ] **Step 3: Make `ConnectMobileSetup` controlled**

In `frontend/src/renderer/components/settings/ConnectMobileSetup.tsx`: delete the `useState` import and the `port` prop, export `SetupMode`, and take the mode from props.

```tsx
import { useTranslation } from "react-i18next";
import { RadioGroup } from "radix-ui";

export type SetupMode = "lan" | "tailscale";

interface ConnectMobileSetupProps {
	/** The selected connection method. Owned by the modal, which encodes the
	 *  matching address into the pairing QR. */
	mode: SetupMode;
	onModeChange: (mode: SetupMode) => void;
	/**
	 * False while the bridge is off; the steps are then collapsed, so their
	 * controls must leave the tab order (same pattern as the pairing block).
	 */
	enabled: boolean;
}
```

Update the component's header comment — the old one states the QR can only ever
carry the LAN address, which this change makes false:

```tsx
// ConnectMobileSetup tells the user what to do with the pairing QR above it and
// which address that QR carries. The mode is owned by ConnectMobileModal so the
// QR can re-encode: LAN mode encodes the private IPv4 from AutopickLANIP, and
// Tailscale mode encodes the 100.64.0.0/10 address from AutopickTailscaleIP
// (backend/internal/mobilebridge/netiface.go).
export function ConnectMobileSetup({ mode, onModeChange, enabled }: ConnectMobileSetupProps) {
	const { t } = useTranslation();
```

Point the `RadioGroup.Root` at the props:

```tsx
			<RadioGroup.Root
				value={mode}
				onValueChange={(value) => onModeChange(value as SetupMode)}
```

The rest of the JSX is unchanged, including `t("mobile.tailscale.step3")` from Task 3. Delete the now-unused `useState` import.

- [ ] **Step 4: Wire the modal**

In `frontend/src/renderer/components/ConnectMobileModal.tsx`:

Add `tailscaleHost` to the local `MobileStatus` interface (line 20):

```tsx
interface MobileStatus {
	enabled: boolean;
	host: string;
	tailscaleHost: string;
	port: number;
	password: string;
	warning: string;
}
```

Import the mode type alongside the component:

```tsx
import { ConnectMobileSetup, type SetupMode } from "./settings/ConnectMobileSetup";
```

Add the state next to the existing `copied` state (near line 56):

```tsx
	const [mode, setMode] = useState<SetupMode>("lan");
```

Reset it when the modal closes, so a stale selection does not survive a reopen. Add to the existing `useEffect` that resets `reportedOpen` (line 76):

```tsx
	useEffect(() => {
		if (!open) {
			reportedOpen.current = false;
			setMode("lan");
			return;
		}
		if (initialEnabled === undefined || reportedOpen.current) return;
		reportedOpen.current = true;
		void captureRendererEvent("ao.renderer.mobile_connect_opened", { bridge_enabled: initialEnabled });
	}, [open, initialEnabled]);
```

Derive the active host just after `const enabled = ...` (line 118):

```tsx
	// The QR encodes whichever address matches the selected tab. Either can be
	// empty — no LAN interface, or Tailscale not running — and an empty host
	// would otherwise produce a QR the phone rejects outright.
	const activeHost = mode === "tailscale" ? (status?.tailscaleHost ?? "") : (status?.host ?? "");
```

Replace the `ConnectMobileSetup` call site (line 248) — it no longer takes `port`:

```tsx
										<ConnectMobileSetup mode={mode} onModeChange={setMode} enabled={enabled} />
```

Replace the QR block (lines 250-259) with the QR-or-hint branch. The
`data-qr-value` attribute is what the test reads, since `qrcode.react` renders
paths rather than text:

```tsx
										<div className="mt-6 flex w-(--size-settings-mobile-qr) flex-col items-center">
											{activeHost ? (
												<>
													<div className="rounded-(--radius-settings-dialog-lg) bg-white p-2 shadow-[var(--shadow-settings-qr)]">
														<QRCodeSVG
															value={pairingPayload(activeHost, status.port, status.password)}
															data-qr-value={pairingPayload(activeHost, status.port, status.password)}
															size={QR_CODE_SIZE}
															className="block size-(--size-settings-mobile-qr-code)"
														/>
													</div>
													<p className="mt-4 text-sm leading-5 text-settings-muted">{t("mobile.scanToPair")}</p>
												</>
											) : (
												<div className="flex size-(--size-settings-mobile-qr-code) items-center justify-center rounded-(--radius-settings-dialog-lg) border border-[var(--color-border-settings-input)] bg-[var(--color-bg-settings-input)] p-4">
													<p className="text-center text-caption leading-(--leading-settings-mobile-hint) text-settings-muted">
														{mode === "tailscale" ? t("mobile.noTailscaleHost") : t("mobile.noPairingHost")}
													</p>
												</div>
											)}
										</div>
```

Update the address row (lines 269-274) to follow the mode and to avoid printing a bare `:3011`:

```tsx
											<div className="flex items-center gap-6 text-sm leading-5" data-testid="mobile-pairing-address">
												<span className="w-(--size-settings-mobile-label) shrink-0 text-settings-muted">{t("mobile.address")}</span>
												<span className="tracking-settings-mono text-settings-label">
													{activeHost ? `${activeHost}:${status.port}` : "—"}
												</span>
											</div>
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cd frontend && npx vitest run src/renderer/components/ConnectMobileModal.test.tsx src/renderer/components/ConnectMobileModal.telemetry.test.tsx src/renderer/components/settings/ConnectMobileSetup.test.tsx`
Expected: PASS, all three files. The telemetry test must still pass unchanged — if it fails on the secrets assertion, note that it asserts the reported payload never contains `192.168.1.20`, which is unrelated to this change.

- [ ] **Step 6: Run the full renderer suite and typecheck**

```bash
cd frontend && npx vitest run src/renderer/
cd frontend && npx tsc --noEmit -p tsconfig.json
```

Expected: PASS and no type errors. `renderer-coverage.test.ts` must pass — every new string goes through `t(...)`, and the `"—"` em dash contains no letters so it is not flagged.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/renderer/components/ConnectMobileModal.tsx \
        frontend/src/renderer/components/ConnectMobileModal.test.tsx \
        frontend/src/renderer/components/settings/ConnectMobileSetup.tsx \
        frontend/src/renderer/components/settings/ConnectMobileSetup.test.tsx
git commit -m "feat(mobile): re-encode the pairing QR for the selected connection method"
```

---

### Task 5: Verify end to end in the real desktop app

**Files:** none modified — this is a manual verification gate before the PR.

**Interfaces:**
- Consumes: everything from Tasks 1-4.
- Produces: confirmation the feature works outside the test suite.

**Background:** Every prior task is unit-tested against fakes. Nothing so far has proved that the real daemon reports a real Tailscale address, or that a phone can actually reach it. The repo has a skill for launching the real Electron app — use it rather than improvising a launch command.

- [ ] **Step 1: Confirm this machine has a Tailscale address**

Run: `ifconfig | grep -B4 "inet 100\." | head -20`
Expected: an `inet 100.x.y.z` on a `utun*` interface. If there is none, Tailscale is not up — start it and sign in, or skip Steps 3-5 and note in the PR that the Tailscale path was verified by unit test only.

- [ ] **Step 2: Launch the real desktop app**

Invoke the `ao-desktop-dev` skill and follow it to build and launch the Electron app from this worktree. Do not hand-roll an `npm run dev` invocation — the skill covers isolated data dirs, stale processes, and port conflicts.

- [ ] **Step 3: Check the API directly**

With the daemon running, from another shell:

```bash
curl -s http://127.0.0.1:3001/api/v1/mobile/status | python3 -m json.tool
```

Expected: JSON containing both `"host"` (a `192.168.x`/`10.x` address) and `"tailscaleHost"` (the `100.x` from Step 1). If `tailscaleHost` is `""` while Step 1 printed an address, Task 1's interface filter is wrong for this machine's interface naming.

- [ ] **Step 4: Exercise the modal**

Open Settings → Connect Mobile, turn on **Enable mobile**, and confirm:
- The LAN tab shows a QR and an address matching `host`.
- Switching to the Tailscale tab **changes the QR image** and the address line to the `100.x` value.
- Switching back restores the LAN QR.

- [ ] **Step 5: Scan with a phone**

With the phone on cellular (Wi-Fi **off**) and Tailscale connected on both devices, scan the Tailscale QR from the AO mobile app. Expected: it pairs and loads the session board without typing anything.

If a phone is not available, verify the address is reachable from another Tailscale node instead:

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<tailscale-ip>:3011/api/v1/sessions
```

Expected: `401` — the port is reachable and auth is armed. A hang or connection-refused means the LAN listener is not serving the Tailscale interface.

- [ ] **Step 6: Confirm the control surface is still blocked over the network**

```bash
curl -s -o /dev/null -w '%{http_code}\n' http://<tailscale-ip>:3011/api/v1/mobile/status
```

Expected: `404`. Anything else means `lanControlBlock` regressed and the pairing password is exposed to the network — stop and fix before opening the PR.

- [ ] **Step 7: Full verification sweep**

```bash
cd backend && go test ./... && go vet ./...
cd frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json
```

Expected: all green. Record the actual output in the PR body — do not claim passing without it.

- [ ] **Step 8: Open the PR**

```bash
git push -u origin ao/agent-orchestrator-mo-24/tailscale-pairing-qr
gh pr create --base main \
  --title "feat(mobile): make the pairing QR scannable over Tailscale" \
  --body "$(cat <<'EOF'
## Summary

Selecting **Tailscale** in Settings → Connect Mobile now re-encodes the pairing
QR with the desktop's `100.x` Tailscale address. Previously the toggle only
swapped instruction text: the QR always carried the LAN address, so a user who
scanned it while on Tailscale paired to an address their phone could not reach,
and the resulting error told them to check they were on the same Wi-Fi.

The QR payload stays at `v: 1` and gains no keys, so this works with every
mobile build already installed — no app release required.

Also fixes a related bug: when the desktop has no address for the selected
method, the modal now shows an explanatory hint instead of encoding
`{"v":1,"host":"",...}`, which the phone rejected as "not an AO pairing code".

## Changes

- `mobilebridge.AutopickTailscaleIP` — finds a `100.64.0.0/10` address on a
  tunnel interface. Deliberately does not reuse `skipInterface`, which drops
  `utun*`.
- `MobileStatusResponse.tailscaleHost` — new field; OpenAPI and the TS schema
  regenerated via `npm run api`.
- `ConnectMobileSetup` is now controlled; `ConnectMobileModal` owns the mode and
  derives the encoded host from it.
- Reworded `mobile.tailscale.step3` and added two hint strings across all eight
  locales.

## Tests

<!-- paste the actual output from Step 7 here -->

## Risks

- Address detection is an interface scan, not the `tailscale` CLI, so it does
  not depend on how Tailscale was installed — but it reports the `100.x`
  address rather than a MagicDNS name.
- `/api/v1/mobile` remains 404 on the LAN listener, so the new field and the
  password are still unreachable from the network (verified in Step 6).

## Follow-ups

- `packages/mobile/lib/connectionError.ts` still says "is your phone on the same
  Wi-Fi?" for an unreachable `100.x` host. Needs an app release, so it is out of
  scope here.
- A `hosts` array letting the phone try Tailscale then LAN automatically is
  deferred; the `v: 1` payload keeps that door open.
EOF
)"
```

---

## Self-Review

**Spec coverage:** Backend picker → Task 1. `tailscaleHost` DTO + regeneration → Task 2. Injectable pickers (spec's Testing section) → Task 2. Renderer controlled mode + `activeHost` + QR-or-hint + address line + mode reset → Task 4. Copy across all locales and `port`-prop removal → Tasks 3 and 4. Empty-LAN-host regression → Task 4, Step 1. "No mobile changes" → enforced in Global Constraints. Out-of-scope items (`connectionError.ts`, `hosts` array) → carried into the PR body's Follow-ups.

**Type consistency:** `AutopickTailscaleIP`/`TailscaleIPv4Candidates` defined in Task 1 and consumed by name in Task 2. `PickLANHost`/`PickTailscaleHost` defined and used consistently in Task 2. `SetupMode`, `mode`, `onModeChange` consistent between Tasks 3 and 4. `tailscaleHost` is the JSON key throughout; `TailscaleHost` the Go field. `pairingPayload` keeps its existing signature.

**Known risk to watch during execution:** Task 4's tests read the payload from a `data-qr-value` attribute passed through `QRCodeSVG`. `qrcode.react` forwards unknown props to the underlying `<svg>`, but if that turns out not to hold in the installed version, assert on the rendered `<svg>` some other way — for example by extracting the component's computed payload into a small exported helper — rather than deleting the assertion.
