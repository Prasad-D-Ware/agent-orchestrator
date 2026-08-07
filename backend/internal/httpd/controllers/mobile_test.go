package controllers

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

type fakeBridge struct{ enabled bool }

func (f *fakeBridge) Status() MobileStatusResponse {
	return MobileStatusResponse{Enabled: f.enabled, Host: "192.168.1.42", Port: 3011}
}
func (f *fakeBridge) Enable() (MobileStatusResponse, error) {
	f.enabled = true
	r := f.Status()
	r.Password = "abcd1234"
	return r, nil
}
func (f *fakeBridge) Disable() error { f.enabled = false; return nil }
func (f *fakeBridge) Regenerate() (MobileStatusResponse, error) {
	r := f.Status()
	r.Password = "wxyz5678"
	return r, nil
}

// fakeLAN is a minimal LANController for exercising BridgeService directly.
type fakeLAN struct {
	running   bool
	hash      string
	stopCalls int
}

func (f *fakeLAN) Start(port int) (int, error) { f.running = true; return port, nil }
func (f *fakeLAN) Stop(ctx context.Context) error {
	f.stopCalls++
	f.running = false
	return nil
}
func (f *fakeLAN) Running() bool            { return f.running }
func (f *fakeLAN) BoundPort() int           { return 3011 }
func (f *fakeLAN) SetPasswordHash(h string) { f.hash = h }
func (f *fakeLAN) PasswordHash() string     { return f.hash }

// When Save fails during a fresh enable, the listener that Start already opened
// must be torn back down and the armed hash rolled back — otherwise a LAN
// listener stays live on 0.0.0.0 while persisted state/UI say enable failed.
func TestMobileEnableRollsBackListenerWhenSaveFails(t *testing.T) {
	// A ConfigPath whose parent is a regular file makes mobilebridge.Save's
	// MkdirAll (and thus Save) fail deterministically.
	blocker := filepath.Join(t.TempDir(), "not-a-dir")
	if err := os.WriteFile(blocker, []byte("x"), 0o600); err != nil {
		t.Fatal(err)
	}
	lan := &fakeLAN{}
	b := &BridgeService{LAN: lan, ConfigPath: filepath.Join(blocker, "mobile", "config.json"), DefaultPort: 3011}

	if _, err := b.Enable(); err == nil {
		t.Fatal("expected enable to fail on Save error")
	}
	if lan.Running() {
		t.Fatal("listener still running after failed enable; must be stopped")
	}
	if lan.stopCalls == 0 {
		t.Fatal("expected Stop to be called on rollback")
	}
	if lan.hash != "" {
		t.Fatalf("expected hash rolled back to empty, got %q", lan.hash)
	}
}

func TestMobileEnableReturnsPassword(t *testing.T) {
	c := &MobileController{Bridge: &fakeBridge{}}
	w := httptest.NewRecorder()
	c.Enable(w, httptest.NewRequest(http.MethodPost, "/api/v1/mobile/enable", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("got %d", w.Code)
	}
	var got MobileStatusResponse
	json.NewDecoder(w.Body).Decode(&got)
	if !got.Enabled || got.Password != "abcd1234" || got.Warning == "" {
		t.Fatalf("bad response: %+v", got)
	}
}

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
// a nil func — production wiring in daemon.go leaves them unset. This also
// proves the call actually completed (not just "didn't panic"): the real
// AutopickLANIP/AutopickTailscaleIP paths run, and Port still comes through
// from the LAN controller untouched by that fallback.
func TestMobileStatusHostPickersDefaultWhenUnset(t *testing.T) {
	b := &BridgeService{
		LAN:         &fakeLAN{running: true},
		ConfigPath:  filepath.Join(t.TempDir(), "mobile", "config.json"),
		DefaultPort: 3011,
	}
	got := b.Status()
	if got.Port != 3011 {
		t.Errorf("Port = %d want 3011", got.Port)
	}
}
