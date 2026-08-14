---
type: spec
id: SPEC-chrome-first-capability
title: Chrome-first capability adapter layer
status: draft
owner: The Sourdaw team
sources:
  - research.md
---

# Chrome-first capability adapter layer

## Intent

Detect platform capabilities once at startup and route every platform-dependent
operation through a frozen capability registry, so the app prefers Chrome-leading
web APIs, falls back to cross-browser standards, and uses Rust native only where
the web has no answer — with degradations made visible to the user rather than
failing silently.

## Non-goals

- Polyfilling missing web APIs in JavaScript.
- Re-detecting capabilities at runtime; detection is single-shot at startup.
- Reaching full feature parity in a stock browser tab — desktop (Tauri) is the
  parity target; the browser build is a documented subset.

## Requirements

### AC-001 — Capabilities resolve through a three-layer model

Each capability must declare its tier — Chrome-leading web API, cross-browser
standard, or Rust native.

Verify with: `pnpm test:run -- capabilityTiers`

### AC-002 — A single frozen registry is the only capability contract

All capability lookups must go through one registry object that is frozen after
startup detection.

Verify with: `pnpm deps:validate`

### AC-003 — Detection runs exactly once at startup

Capability detection must execute one time during app initialization and cache
the result; subsequent lookups must not re-probe the platform.

Verify with: `pnpm test:run -- capabilityDetectionSingleShot`

### AC-004 — Every platform operation routes through a domain adapter

Each of the platform domains (filesystem, MIDI, HID, audio, storage, fonts,
clipboard, observability) must expose a Pattern-B adapter whose call sites never
touch a raw web or Tauri API directly.

Verify with: `pnpm test:run -- domainAdapters`

### AC-005 — Cross-origin isolation is configured for SharedArrayBuffer

The app must serve `COOP: same-origin` and `COEP: require-corp` headers so
`SharedArrayBuffer` and high-resolution timers are available where the runtime
supports them.

Verify with: `manual` — load the app, confirm `crossOriginIsolated === true` in the console

### AC-006 — Adapters are testable with an injected capability profile

Each adapter must accept an injected capability profile so a test can drive it
with a synthetic Chrome / WebView2 / WKWebView / WebKitGTK profile.

Verify with: `pnpm test:run -- adapterProfileInjection`

### AC-007 — Degradations are surfaced to the user

When a capability resolves to a lower tier or is unavailable, the adapter must
expose a structured degradation notice the UI can present, rather than throwing
or silently no-op'ing.

Verify with: `pnpm test:run -- capabilityDegradationNotice`

### AC-008 — A dev-mode override forces a capability tier

In development builds, an override mechanism must let a developer pin any
capability to a chosen tier to exercise fallback paths.

Verify with: `pnpm test:run -- capabilityDevOverride`

### AC-009 — No cross-module internal imports

This change must not introduce cross-module internal imports.

Verify with: `pnpm deps:validate`

### AC-010 — Per-domain routing is fixed per runtime via the D1–D8 tables

Each platform domain (D1 filesystem, D2 directory access, D3 file-watching, D4
MIDI, D5 HID/Serial/USB/Bluetooth, D6 audio engine, D7 inter-thread bridge, D8
GPU) must resolve to the spec-fixed default adapter and fallback ordering per
runtime at init — e.g. D3 file-watching defaults to the Rust `notify` crate on
all Tauri runtimes with Chrome ≥133 FileSystemObserver as an optional
optimization only — with no per-call probing.

Verify with: `pnpm test:run -- domainRoutingTable`

### AC-011 — Tauri IPC respects the audio/security boundary

Real-time audio buffers must never cross the Tauri JS↔Rust IPC boundary (the
native engine talks to hardware via `cpal`; the UI receives only metering,
transport state, and decimated waveform data at UI cadence).

Verify with: `pnpm deps:validate`

### AC-012 — Platform adapters are code-split out of foreign builds

Browser builds must pull in zero files under `adapters/tauri/**`, enforced by a
guarded local bundle-size audit over the emitted chunk graph.

Verify with: `pnpm build` then a chunk-graph audit asserting no forbidden adapter paths are emitted

### AC-013 — Adapter handles are nominally branded

Each adapter must expose a per-adapter branded handle type (`TauriFileHandle`,
`OPFSFileHandle`, `ChromeFileHandle`) so passing a handle from one adapter to
another adapter's method is a compile error.

Verify with: `pnpm test:run -- brandedHandleTypes` (a type-level `expectTypeOf` test)

### AC-014 — The audio engine uses the Native Shadow pattern

The audio engine (D6) must route outside the generic adapter factory via the
Native Shadow variant: the same Rust DSP core compiled to both native (`cpal`)
and `wasm32-unknown-unknown`, exposing a uniform `AudioEngineController`
interface to the UI, with the registry surfacing only an `audioEngine.mode`
(`'native' | 'wasm'`) tag.

Verify with: `pnpm test:run -- audioEngineNativeShadow`

### AC-015 — Startup detection meets a measured latency budget

The capability probe must resolve within 50 ms on a cold start on desktop and
within 20 ms in browser, measured with `performance.now()` and asserted by a
recorded startup-timing test on the supported platform matrix.

Verify with: `pnpm test:run -- startupDetectionLatency`

### AC-016 — Per-runtime web-API coverage baselines are encoded

The planning baselines (~70% web-API coverage on WebView2/Windows, ~45% on
WKWebView/macOS, ~40% on WebKitGTK/Linux, with the remainder Rust-covered) must
be recorded as the planning input that determines which adapters must exist per
runtime; the per-domain D1–D8 routing remains the normative source of truth.

Verify with: `pnpm test:run -- runtimeCoverageBaselines`

### AC-017 — Device I/O is Rust-only on desktop with no Chrome accelerator

On Tauri desktop, HID/Serial/USB/Bluetooth must route to Rust native (`hidapi`,
`serialport`, `nusb`/`rusb`, `btleplug`) and must not use web device APIs even
where available — because WebUSB excludes audio-class devices a DAW needs,
WebView2 chooser rendering is documented-broken, and browser-style permission
dialogs in a desktop app are a UX regression with no offsetting performance
gain.

Verify with: `pnpm test:run -- deviceIoRustOnly`

### AC-018 — Documented platform-quirk degradations are surfaced, not silent

The adapter layer must surface known platform quirks as structured states rather
than silent failure: the WKWebView 10 MB OPFS per-file limit must surface
`AdapterError { kind: 'unsupported' }` at write time (not an I/O error).

Verify with: `pnpm test:run -- platformQuirkDegradations`

### AC-019 — COOP/COEP may degrade to `credentialless` as a recorded policy

The cross-origin-isolation policy must support a deliberate spec-level fallback
from `require-corp` to `credentialless` (Chrome 96+ / Safari 15.2+) when
third-party assets cannot be self-hosted, configured at build time rather than
selected per request at adapter time.

Verify with: `manual` — build with the `credentialless` policy and confirm `crossOriginIsolated === true` with a non-self-hostable cross-origin asset loaded

### AC-020 — Dev-mode override has a concrete, named mechanism

The dev override must be the `SOURDAW_CAPABILITY_OVERRIDE` env var plus a
`?capabilityOverride=` URL param in browser mode, accept named presets
(`webkit` / `chrome` / `browser-fallback` / `native-only`), and be read before
detection and rejected in production builds.

Verify with: `pnpm test:run -- capabilityOverridePresets`

### AC-021 — A developer-facing Capabilities panel shows the resolved profile

A Capabilities panel reachable from settings must render, per domain, the
resolved adapter, its source layer, and the override banner when an override is
active — a diagnostic surface, not prominently advertised.

Verify with: `manual` — open the Capabilities panel and confirm each domain shows resolved adapter, source layer, and any override banner

### AC-022 — The resolver selects the highest available tier

The resolver must select the highest available tier for the current runtime.

Verify with: `pnpm test:run -- capabilityTiers`

### AC-023 — No module sniffs the platform independently

No module may branch on `navigator.userAgent` or feature sniff independently.

Verify with: `pnpm deps:validate`

### AC-024 — Tauri commands accept opaque IDs only

Tauri commands must accept opaque IDs (e.g. `loadProjectFile(projectId)`) rather
than arbitrary filesystem paths, raw USB/HID byte streams, shell execution, or
ad-hoc SQL.

Verify with: `pnpm deps:validate`

### AC-025 — Chrome-only adapters are code-split out of Tauri / WKWebView builds

Tauri / WKWebView builds must pull in zero files under `adapters/chrome-only/**`
(except on a runtime where the chrome-only adapter is the resolved one), enforced
by a guarded local bundle-size audit over the emitted chunk graph.

Verify with: `pnpm build` then a chunk-graph audit asserting no forbidden adapter paths are emitted

### AC-026 — WKWebView audio backgrounding wires AudioContext to focus

WKWebView audio backgrounding must wire AudioContext suspend/resume to window
focus/blur.

Verify with: `pnpm test:run -- platformQuirkDegradations`

### AC-027 — The probe records the WebKitGTK version for support triage

The probe must record the WebKitGTK version (target ≥ 2.44) for support triage.

Verify with: `pnpm test:run -- platformQuirkDegradations`

### AC-028 — The Capabilities panel shows an active-override banner

The Capabilities panel must render a prominent "OVERRIDE ACTIVE" banner when an
override is in effect.

Verify with: `pnpm test:run -- capabilityOverridePresets`

### AC-029 — The D1–D8 per-domain default/fallback routing is encoded as the normative table

The per-domain default-adapter and fallback ordering named by AC-010 and AC-016
must be encoded verbatim from this normative table (no per-call probing; routing
fixed at init):

| Domain | Runtime | Default / fallback |
| --- | --- | --- |
| D1 Filesystem & project storage | Tauri/Windows, macOS, Linux | Tauri `fs` plugin + dialog plugin (FSA optional on Windows for in-session handle reuse only; OPFS capped at 10 MB/file on WKWebView, autosave only) |
| D1 | Browser/Chrome | File System Access API (IndexedDB handle caching; re-grant each session) |
| D1 | Browser/Safari, Firefox | OPFS (≤ 10 MB) + `<input type="file">` (documented degraded mode) |
| D2 Directory access & persistence | Tauri (all) | Tauri scoped fs (`$HOME`, `$AUDIO`, `$APPDATA`) + `tauri-plugin-persisted-scope` |
| D2 | Browser/Chrome | `showDirectoryPicker()` + IndexedDB-cached `FileSystemDirectoryHandle` |
| D2 | Browser/other | No persistent directory access — re-pick per session |
| D3 File watching | Tauri (all) | Rust `notify` crate (forwarded to frontend via Tauri event) |
| D3 | Browser/Chrome ≥ 133 | FileSystemObserver (optional optimization; OPFS or FSA-granted dirs only) |
| D3 | Browser/other | None (polling only for OPFS); UI shows watch-disabled state |
| D4 MIDI | Tauri (all) | Rust `midir` via `tauri-plugin-midi` (always Rust on desktop) |
| D4 | Browser/Chrome | Web MIDI API (sole option) |
| D4 | Browser/Safari, Firefox | None ("MIDI unavailable") |
| D5 HID / Serial / USB / Bluetooth | Tauri (all) | Rust native (`hidapi`, `serialport`, `nusb`/`rusb`, `btleplug`) |
| D5 | Browser/Chrome | WebHID/Serial/USB/Bluetooth (subset experience) |
| D5 | Browser/other | None ("requires desktop app") |
| D6 Audio engine | Tauri (all) | Rust native via `cpal` (sub-10 ms latency target) |
| D6 | Browser (all) | AudioWorklet + WASM (same Rust DSP core to `wasm32-unknown-unknown`; ~30 ms best-case RT latency) |
| D7 Inter-thread bridge | All (where isolated) | SharedArrayBuffer ring buffers (`ringbuf.js` pattern) |
| D7 | No COI | Degraded mode: `postMessage` fallback, documented |
| D8 GPU compute / visualization | Where WebGPU available | WebGPU |
| D8 | Linux/WebKitGTK + pre-Tahoe macOS | WebGL2 fallback or Rust `wgpu` via Tauri command |

Verify with: `pnpm test:run -- domainRoutingTable`

### AC-030 — The D7 inter-thread bridge defaults to SAB ring buffers with a postMessage fallback

Where the runtime is cross-origin-isolated, the D7 inter-thread bridge between
worker/worklet and UI thread must default to SharedArrayBuffer ring buffers (the
`ringbuf.js` pattern — Paul Adenot's `ringbuf.js` is the reference implementation
of this lock-free SAB-with-`Atomics` pattern), with `Atomics.waitAsync` (Safari
16.4+) usable as an optional SAB-backed waiting enhancement; where COI is absent
it must fall back to a documented `postMessage` channel rather than failing.

Verify with: `pnpm test:run -- domainRoutingTable`

### AC-031 — COI-off boots in degraded mode and records it in the registry

When `self.crossOriginIsolated === false`, the registry must record
`sharedArrayBuffer: 'unavailable'` and the app must still boot; an integration
test with COI forced off must verify the app boots without throwing and exposes
the degraded-mode state.

Verify with: `pnpm test:run -- coiOffDegradedBoot`

### AC-032 — Native file commands resolve path authority in native state

Collaboration-bundle and generated-audio file commands must resolve filesystem
authority from native-owned project/output state. Command-level tests provide a
divergent renderer path and prove that each command either rejects the request
or accesses only the native-owned path, leaving the divergent path untouched.

Verify with: the following fail-fast command.

```sh
rg -Uq '(?m)^[ \t]*#\[test\][ \t]*\r?\n[ \t]*fn rejects_divergent_renderer_path_authority\(\)[ \t]*\{' \
  src-tauri/src/commands/collab.rs &&
  rg -Uq '(?m)^[ \t]*#\[test\][ \t]*\r?\n[ \t]*fn ignores_divergent_renderer_path_authority\(\)[ \t]*\{' \
    src-tauri/src/commands/audio_postprocess.rs &&
  cargo test -p sourdaw --lib divergent_renderer_path_authority
```

## Open questions

- [ ] (blocking) [CRITICAL] Which File System Access persistence strategy does
  the Chrome/Windows D1 adapter use? FSA permissions do not persist across
  sessions (the user must re-grant every launch) and WebView2's
  `PermissionRequested` event does not consistently surface FSA prompts, so host
  UI interception cannot be relied on. Options: (a) silently re-request with a
  user prompt on each launch; (b) drop the FSA adapter entirely on Tauri/Windows
  and always use Tauri scoped fs; (c) use FSA only for in-session subsequent
  reads after the initial Tauri-dialog grant. This decides whether FSA ships as
  an optional Windows enhancement at all; must be decided before D1
  implementation starts.
- [ ] (blocking) Which domains demand a Rust-native floor on every platform
  (e.g. low-latency MIDI on WKWebView, raw HID) versus tolerating a web
  fallback? The D1–D8 routing table needs sign-off before adapters are frozen.
- [ ] (blocking) Where are COOP/COEP headers set for the Tauri custom protocol
  versus the dev server, and does WKWebView honor them identically?
- [ ] (non-blocking) Should the registry be lazy-loaded per domain to cut
  startup cost, or fully eager?
- [ ] (non-blocking) (restored detail) Should windowing / titlebar / shell
  integration become a managed domain, and if so what does its adapter own?
  Window Controls Overlay is Chromium/PWA-only and irrelevant to Tauri; the Tauri
  path is custom titlebars via `decorations: false` + `data-tauri-drag-region`,
  `titleBarStyle: "overlay"` / `"transparent"` on macOS for traffic lights,
  `alwaysOnTop` for floating mixer/transport windows, `windowEffects` for
  platform vibrancy/mica, multi-webview windows for complex layouts, and
  per-window capability sets via Tauri's per-window security model. Today this is
  not assigned a D-domain.
- [ ] (non-blocking) (restored detail) Launch / open-with / file-association
  behavior is currently unassigned. Chrome's Launch Handler and File Handling
  APIs are PWA-specific manifest features irrelevant to Tauri; file associations
  go through Windows registry entries, macOS Info.plist UTI declarations, and
  Linux `.desktop` MIME associations (all in Tauri's bundler config), and apps
  receive file paths via CLI arguments or deep links. Decide whether this needs
  an adapter/domain or stays bundler-config only.
- [ ] (non-blocking) (restored detail) Media decode/encode is out of this layer's
  scope (no D9), but the WebCodecs caveats must be carried to the owning audio
  engine / media-import spec: `AudioDecoder` produces `AudioData` in `f32`
  interleaved format needing conversion to Web Audio's `f32-planar`; there is no
  built-in container demuxing (MP4/WebM parsing needs libraries); and WebKitGTK
  support depends on GStreamer plugins, with FDK AAC via gst-plugins-bad
  preferred over gst-libav's (buggy, disabled) AAC. The `symphonia`/Rust path is
  the default on native.

## Affected areas

- `src/infra/capability/` (registry, detection, tier model)
- `src/infra/platform/` (filesystem, MIDI, HID, audio, storage adapters)
- `src-tauri/` (native capability commands, COOP/COEP protocol config)

## Known risks

- (restored detail) WebUSB blocks the audio, video, HID, and mass-storage USB
  device classes — precisely the classes a DAW needs — and on Windows devices
  often require WinUSB driver installation; this is the concrete evidence behind
  AC-017's Rust-only device floor (research §§2.5–2.8). WebHID further blocks the
  protected usages (keyboards, mice, FIDO keys) that `hidapi` also blocks, while
  the legitimate DAW use case is motorized faders, rotary encoders, and LED
  button matrices.
- (restored detail) BLE MIDI devices present as system-level MIDI devices once
  OS-paired, so they are visible to `midir` without direct BLE access — `btleplug`
  is only needed for direct GATT interaction (research §2.8, §6).
- (restored detail) FileSystemObserver (D3, Chrome ≥ 133) remains experimental and
  non-standard — its spec PR is still pending at `whatwg/fs#165`, it is absent from
  WKWebView and WebKitGTK, and it may fire `unknown`-type events on observation-queue
  overflow. This is the evidence behind AC-010 / AC-029 treating it as an optional
  optimization only, never the sole watch path (the Rust `notify` crate is the
  canonical D3 path; research §2.3).

## Dropped from sources

- The full per-API capability inventory and support matrix lives in `research.md`
  rather than the spec.
- Browser-tab parity goals — the browser build is explicitly a documented subset,
  not a parity target.
- Speculative future-API tracking (WebGPU compute beyond audio, WebTransport) —
  added to the registry when a consuming feature needs them.
