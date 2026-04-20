# Spec: Chrome-First Capability Adapter Layer

## Reference research

- `.agents/research/platform/chrome-first.md` — three-layer capability model, per-runtime support matrix (Chrome/WebView2/WKWebView/WebKitGTK), adapter-pattern analysis (Patterns A–E), decision framework, domain-by-domain routing case studies, and the risk register. All evidence tables, browser-version numbers, OPFS/SAB quirk details, and quantitative latency figures live in the research file. This spec references them by section number but does not re-embed them.

---

## Context

Sourdaw targets **two deployment shapes** from one codebase: desktop via Tauri V2 (Windows/WebView2, macOS/WKWebView, Linux/WebKitGTK) and browser (primarily Chromium). Each shape exposes a different set of web platform capabilities, and WebKit in particular has **formally absent** APIs — Web MIDI, WebHID, Web Serial, WebUSB, Web Bluetooth, File System Access, and FileSystemObserver are not implemented and are not on any roadmap. A DAW that uses Chromium-only APIs naively therefore has no functional MIDI, device I/O, or file-watching on macOS and Linux.

The research (§§1, 3) establishes a **three-layer capability model** as the governing architecture:

- **Layer 1 — Chrome-leading.** Project Fugu and Chrome-only APIs (File System Access, FileSystemObserver, `scheduler.postTask`) — used only when they provide measurable product advantage and only on the runtimes where they are implemented.
- **Layer 2 — Cross-browser standards.** OPFS, Web Audio + AudioWorklet, SharedArrayBuffer, WebCodecs, IndexedDB, Cache API, WebGPU (where supported). These form the reliable middle tier across all three WebView engines, subject to documented per-runtime quirks (e.g. WKWebView's 10 MB OPFS per-file limit).
- **Layer 3 — Rust native.** MIDI, HID, USB, Serial, Bluetooth, file watching, file dialogs, window/shell integration, the real-time audio engine, and VST/CLAP/AU hosting. Rust is the *primary* implementation — not a fallback — for every capability that is either functionally absent on WebKit, requires sub-10 ms deterministic timing, or must behave identically across all platforms.

Per the research §1, actual web-API coverage is **~70 % on Windows (WebView2)**, **~45 % on macOS (WKWebView)**, **~40 % on Linux (WebKitGTK)**. The delta is covered by Rust.

Today Sourdaw's codebase has no capability registry, no adapter pattern, and scattered ad-hoc platform checks. This spec introduces a **Capability Adapter Layer** (Pattern B in the research) that centralises detection, fixes one concrete adapter per domain at startup, and never silently switches mid-session.

---

## Goal

Introduce a frozen, startup-detected Capability Registry and a per-domain Capability Adapter Layer so every feature in Sourdaw reaches platform APIs through a typed, code-split, independently testable adapter whose identity is fixed for the life of the session.

---

## User-visible behavior

- **Every runtime has a committed capability profile.** On launch the app detects its runtime once, picks one adapter per capability domain, and the user experience is consistent for the whole session.
- **Degradations are visible, never silent.** When a capability is missing (e.g. Web MIDI in Safari-only browser mode), the affected UI shows an explanatory state — not an empty device list.
- **Feature parity on desktop.** Desktop Tauri builds on all three platforms expose the same MIDI, file watching, device I/O, and audio latency characteristics because the adapter layer routes them all to Rust.
- **No Tauri code in browser builds.** Users running Sourdaw in a browser never download Tauri adapters; users running Tauri never download the Chrome-only File System Access adapter on platforms where it is not used.
- **A Capabilities panel in settings** shows the active adapter per domain and the reason (e.g. "MIDI: Rust native via `tauri-plugin-midi`", "Filesystem: Tauri scoped fs + OPFS autosave cache"). Intended as a diagnostic surface, not prominently advertised.

---

## Scope

### In scope

- A `CapabilityRegistry` runtime-level primitive: single-shot detection at app start, frozen readonly object for the rest of the session, consumed by domain adapters.
- A per-domain **Capability Adapter Layer** covering the eight domains listed in R4.
- Code-splitting and lazy loading: browser-mode bundles do not include Tauri adapter code, and Tauri bundles do not include Chrome-only adapters on platforms where they are never selected.
- Branded handle types per adapter (e.g. `TauriFileHandle`, `OPFSFileHandle`, `ChromeFileHandle`) so handles from one adapter cannot be passed to another at compile time.
- COOP/COEP header configuration for Tauri production builds and the Vite dev server, plus a runtime `self.crossOriginIsolated` check with a user-visible warning if SAB is unavailable.
- A test harness per adapter and a platform-matrix CI configuration.
- A dev-mode override flag that pins the registry to a specific adapter combination (`SOURDAW_CAPABILITY_OVERRIDE` or equivalent) — off by default, ignored in production builds.
- A developer-facing Capabilities panel showing the resolved profile.

### Non-goals (explicitly out of scope)

- **Runtime capability switching mid-session.** The registry is frozen after init. Hot-swapping adapters after startup is not supported and not needed; a runtime change (e.g. user launches the desktop app instead of browser) means a new session and a new registry.
- **Replacing existing specific Tauri plugin configurations.** This spec does not redesign `tauri-plugin-fs` scoping, the MIDI plugin's permission file, or audio entitlements — those are owned by their own specs. This spec only defines how the frontend adapter layer *consumes* them.
- **Designing the concrete Rust audio engine, MIDI plugin, or plugin-hosting sidecar.** Those have their own specs (`../pipelines/audio-generation-browser.md`, the MIDI plugin spec, plugin-hosting skill, etc.). This spec fixes the adapter contract those implementations must satisfy.
- **Per-call feature detection.** Components must consume adapters, never probe `'showOpenFilePicker' in window` themselves.
- **"Optimistic try/catch" adapter resolution (Pattern E in research).** Explicitly rejected.
- **Mobile (iOS/Android) runtime targets.** Covered by separate future work; the registry interface is designed to accommodate them but no mobile adapters ship in scope here.
- **Removing already-existing platform checks in unrelated modules.** Migrating callers to the adapter layer is a follow-up workstream tracked separately.
- **Chromium-only UI scheduling APIs (`scheduler.postTask`, `scheduler.yield`).** Research §§2.10, 4 classify these as Layer 1 with marginal benefit for a DAW; not owned by this adapter layer. If adopted later, they ship as a non-adapter UI-scheduling utility with clear browser gating.
- **Media decode/encode routing (WebCodecs, container demux).** Owned by the audio engine and media-import specs. Research §§2.13, 13 note WebKitGTK caveats for WebCodecs; the `symphonia`/Rust path is the default on native. This adapter layer does not define a media domain (would have been a potential D9).
- **Clipboard / drag-drop / Web Share routing.** Research §2.15 notes `navigator.share` is broken on WebView2 and clipboard behavior differs per runtime — these are tracked as risks in Tradeoffs but do not get a D* domain in v1.

---

## Requirements

Each requirement has at least one verifiable acceptance criterion.

### R1. Three-layer capability model is formally encoded

The Layer 1 / Layer 2 / Layer 3 routing model (research §§1, 2, 4–6) is expressed as a typed classification per capability domain in code, not as prose documentation. Every domain covered by R4 declares a `defaultLayer` and a fallback ordering per runtime.

**Expected baselines (research §1):**

| Runtime             | Expected Web-API coverage | Rust-covered remainder |
| ------------------- | ------------------------- | ---------------------- |
| WebView2 (Windows)  | ~70 %                     | ~30 %                  |
| WKWebView (macOS)   | ~45 %                     | ~55 %                  |
| WebKitGTK (Linux)   | ~40 %                     | ~60 %                  |

These are planning baselines, not compile-time assertions. They inform which adapters must exist; the **per-domain routing in R4 is the normative source of truth**.

**Acceptance criteria:**

- [ ] Each capability domain in R4 has a declared `defaultLayer: 1 | 2 | 3` and a per-runtime `resolvedAdapter` value exposed on the registry.
- [ ] A unit test enumerates every runtime × domain pair and asserts the resolved adapter matches R4.
- [ ] The Capabilities panel renders the resolved adapter and source layer for each domain.

---

### R2. Capability Adapter registry exists as a single contract surface

A central `CapabilityRegistry` module defines: the typed capability interfaces (one per domain), the concrete adapter implementations (one per platform path per domain), branded handle types, and a factory that returns the correct adapter given the resolved registry.

**Constraints:**

- The registry module lives under `src/modules/Platform/` (or equivalent platform/infra module). Its root `index.ts` is the **only** cross-module entry point; all adapter internals are private to the module and not exported.
- Each adapter is in its own file, registered by a factory. No barrel file re-exports adapters directly to consumers.
- Adapters are **lazy-loaded via dynamic `import()`** so tree-shaking and route-based code splitting eliminate unused platform paths. Static imports of platform-specific adapters from consumer code are forbidden.
- Each capability domain defines a **branded handle type** (e.g. `type TauriFileHandle = { readonly __brand: 'TauriFileHandle'; id: string }`). Handles from one adapter are not structurally assignable to handles from another.
- No `any`, no `as unknown as`, no `@ts-ignore` may be used to erase adapter-type boundaries. Use discriminated unions on the registry and narrow at the consumer.

**Acceptance criteria:**

- [ ] `CapabilityRegistry` exports a typed `Registry` value and typed capability interfaces for every domain in R4.
- [ ] A **bundle-size audit** test: loading the browser entry point does not pull in any file whose path matches `**/adapters/tauri/**`. Loading the Tauri entry point does not pull in `**/adapters/chrome-only/**` except on runtimes where it is the resolved adapter.
- [ ] A type-level test (`expectTypeOf`) asserts that a `TauriFileHandle` cannot be passed to an `OPFSFileSystemAdapter.read()` call and vice versa.
- [ ] All adapter files under `src/modules/Platform/adapters/**` are imported only via `registry.get<Domain>Adapter()` — enforced by an ESLint rule or `pnpm deps:validate` check.

---

### R3. Startup detection is single-shot and the registry is frozen

Capability detection runs exactly once, during app bootstrap, before any UI renders that depends on a capability. The result is written to the registry and the registry object is then frozen (`Object.freeze` or equivalent) and never mutated for the life of the session.

**Detection inputs (research §§1, 7, 13):**

- `window.__TAURI_INTERNALS__` presence → Tauri runtime.
- `navigator.userAgent` / `navigator.userAgentData` → platform discrimination (Win/macOS/Linux) when Tauri.
- `self.crossOriginIsolated` → SAB eligibility.
- Feature-presence probes: `'showOpenFilePicker' in window`, `'FileSystemObserver' in self`, `'requestMIDIAccess' in navigator`, `'hid' in navigator`, `'serial' in navigator`, `'usb' in navigator`, `'bluetooth' in navigator`, `'gpu' in navigator`.
- For WebGPU and AudioWorklet: presence check only; no live instantiation at bootstrap (latency budget).
- Tauri-side: a single `invoke('capability::probe')` command returns platform identity, Rust plugin availability, and entitlement status (microphone, filesystem scopes granted).

**Acceptance criteria:**

- [ ] The probe resolves (all detection inputs read) within **50 ms** on a cold start on all three desktop platforms; browser cold start within **20 ms**. Measured with `performance.now()` and asserted by a startup-timing test.
- [ ] The registry object is frozen after init: a test that mutates any field throws.
- [ ] Re-calling the registry factory returns the same frozen instance — no second probe, no re-detection.
- [ ] No component queries `window.*` feature flags directly after bootstrap completes; enforced by a lint rule banning direct feature-detection calls outside `src/modules/Platform/`.

---

### R4. Per-domain routing is fixed per runtime

The spec fixes the **default adapter** and **fallback ordering** for each domain below. "Default" = selected when its platform preconditions are met; "Fallback" = selected if the default is unavailable for that runtime. All routing is decided at init from the registry; no per-call probing.

All routing decisions trace to the research support matrix (§3) and the decision framework (§§4–6, 8, 14).

#### D1 — Filesystem & project storage

| Runtime                  | Default                                | Notes                                                                |
| ------------------------ | -------------------------------------- | -------------------------------------------------------------------- |
| Tauri/Windows (WebView2) | Tauri `fs` plugin + dialog plugin      | Optional: File System Access API for in-session handle reuse only.   |
| Tauri/macOS (WKWebView)  | Tauri `fs` plugin + dialog plugin      | FSA absent. OPFS capped at **10 MB per file** — autosave cache only. |
| Tauri/Linux (WebKitGTK)  | Tauri `fs` plugin + dialog plugin      | FSA absent.                                                          |
| Browser/Chrome           | File System Access API                 | IndexedDB handle caching; re-grant each session.                     |
| Browser/Safari, Firefox  | OPFS (≤ 10 MB) + `<input type="file">` | Documented degraded mode.                                            |

#### D2 — Directory access & persistence

| Runtime        | Default                                                                           |
| -------------- | --------------------------------------------------------------------------------- |
| Tauri (all)    | Tauri scoped fs (`$HOME`, `$AUDIO`, `$APPDATA`) + `tauri-plugin-persisted-scope`. |
| Browser/Chrome | `showDirectoryPicker()` + IndexedDB-cached `FileSystemDirectoryHandle`.           |
| Browser/other  | No persistent directory access — user must re-pick per session.                   |

#### D3 — File watching

| Runtime              | Default                                    | Notes                                                  |
| -------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Tauri (all)          | Rust `notify` crate                        | Canonical path. Forwarded to frontend via Tauri event. |
| Browser/Chrome ≥ 133 | FileSystemObserver (optional optimization) | Only for OPFS or FSA-granted directories.              |
| Browser/other        | None (polling only for OPFS, if needed)    | UI shows watch-disabled state.                         |

#### D4 — MIDI

| Runtime           | Default                              | Notes                                              |
| ----------------- | ------------------------------------ | -------------------------------------------------- |
| Tauri (all)       | Rust `midir` via `tauri-plugin-midi` | **Always Rust on desktop** (research §2.4, §13.2). |
| Browser/Chrome    | Web MIDI API                         | Sole option.                                       |
| Browser/Safari,FF | None                                 | Capabilities panel shows "MIDI unavailable".       |

#### D5 — HID / Serial / USB / Bluetooth

| Runtime        | Default                     | Notes                                                                    |
| -------------- | --------------------------- | ------------------------------------------------------------------------ |
| Tauri (all)    | Rust native                 | `hidapi`, `serialport`, `nusb`/`rusb`, `btleplug`. See note below.       |
| Browser/Chrome | WebHID/Serial/USB/Bluetooth | Subset experience; browser-only mode with explicit capability messaging. |
| Browser/other  | None                        | UI surfaces "requires desktop app".                                      |

**Note on device I/O routing:** On Tauri desktop, web device APIs (WebHID/Serial/USB/Bluetooth) are **not** used even as accelerators where available. They provide no performance gain over Rust crates, create browser-style permission dialogs inside a desktop app, and WebUSB blocks audio-class devices — precisely the class a DAW needs. See research §§2.5–2.8, §6, §10 for evidence.

#### D6 — Audio engine

| Runtime       | Default                                                                       | Notes                                             |
| ------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| Tauri (all)   | Rust native via `cpal`                                                        | Sub-10 ms latency target. See audio-engine skill. |
| Browser (all) | AudioWorklet + WASM (same Rust DSP core compiled to `wasm32-unknown-unknown`) | ~30 ms best-case RT latency; documented.          |

Audio engine routing does not use the regular adapter factory — it uses the **Native Shadow** variant (Pattern D in research §7). The same DSP core compiles to both targets; only the I/O substrate changes. The adapter exposes a uniform `AudioEngineController` interface to the UI.

#### D7 — Inter-thread bridge

| Runtime              | Default                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------- |
| All (where isolated) | SharedArrayBuffer ring buffers (`ringbuf.js` pattern) between worker/worklet and UI thread. |
| No COI               | Degraded mode: `postMessage` fallback, documented.                                          |

#### D8 — GPU compute / visualization (tier alignment only; not a full adapter)

| Runtime                           | Default                                          |
| --------------------------------- | ------------------------------------------------ |
| Where WebGPU available            | WebGPU                                           |
| Linux/WebKitGTK + pre-Tahoe macOS | WebGL2 fallback or Rust `wgpu` via Tauri command |

D8 is listed here for completeness but may ship as a thinner "renderer selector" rather than a full adapter, since the two paths share no handle types.

**Acceptance criteria for R4:**

- [ ] For each domain D1–D7, a routing-table test asserts the resolved adapter per runtime matches this spec.
- [ ] Changing the default routing for any domain requires a spec update — enforced by snapshot test on the routing table.

---

### R5. COOP/COEP policy is configured and observable

Cross-origin isolation headers are configured in Tauri production builds and the Vite dev server. Runtime code reads `self.crossOriginIsolated` at bootstrap and records the outcome in the registry.

**Configuration:**

```json
{
  "app": {
    "security": {
      "headers": {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "require-corp"
      }
    }
  }
}
```

Identical headers configured in `vite.config.ts` dev-server options.

**Fallback policy (research §16 — risk item):** If `require-corp` blocks third-party assets that cannot be self-hosted, the policy may degrade to `credentialless` (Chrome 96+ / Safari 15.2+). This is a deliberate spec-level decision, not an adapter-time fallback.

**If SAB is unavailable at runtime** (`self.crossOriginIsolated === false`):

- Registry records `sharedArrayBuffer: 'unavailable'`.
- The audio-engine inter-thread bridge degrades to `postMessage` with documented performance impact.
- A one-time diagnostic warning is surfaced in the Capabilities panel.

**WebKitGTK belt-and-suspenders (Linux):** On some WebKitGTK configurations, COOP/COEP alone is insufficient and `JSC_useSharedArrayBuffer=1` must also be exported in the launcher environment (research §§2.9, 16). If the SAB probe fails on a WebKitGTK runtime where headers are correct, check this env var before degrading. `Atomics.waitAsync` is available on Safari 16.4+ as an optional enhancement path for SAB-backed ring-buffer waiting.

**Acceptance criteria:**

- [ ] `tauri.conf.json` and `vite.config.ts` both declare COOP/COEP headers.
- [ ] An integration test loads the app in a headless browser and asserts `self.crossOriginIsolated === true`.
- [ ] An integration test with COI forced off verifies the app still boots and exposes the degraded-mode state in the registry.

---

### R6. Adapter contract is independently testable

Each capability adapter implements a typed interface that can be unit-tested without the platform it targets being present. Adapter tests live alongside the adapter file in the module's `__tests__/` folder (per `.agents/skills/testing-file-layout/SKILL.md`).

**Contract requirements:**

- Each domain defines a `CapabilityAdapter<Domain>` interface with async-only methods (no sync I/O outside worker-scoped OPFS adapters).
- Each method returns a typed `Result<T, AdapterError>` or a `Promise<T>` that throws a typed `AdapterError` — errors are never silent.
- Adapter errors carry a discriminated `kind` field (`'unsupported'`, `'permission-denied'`, `'io'`, `'platform-unavailable'`) so consumers can branch without string matching.
- Adapters are constructed via their factory only; no `new ChromeFSAdapter()` direct construction from consumer code.

**Test harness:**

- Per-adapter unit tests using fake implementations of the underlying platform API (e.g. a fake `navigator.requestMIDIAccess`).
- Contract tests: a shared parameterised suite runs against every adapter for a domain and asserts interface conformance (method signatures, error types, branded-handle round-trips).
- No test may assert only `toBeDefined` / `toBeTypeOf('object')`; every assertion names an expected value (per `AGENTS.md` — "TypeScript — soundness").

**Acceptance criteria:**

- [ ] Every adapter has a `__tests__/<adapter>.spec.ts` file with ≥ one contract-conformance test.
- [ ] A shared contract suite exists per domain and runs against every registered adapter for that domain.
- [ ] Vitest run passes with zero skips in the adapter test suites.

---

### R7. Dev-mode capability override flag

Developers can force the registry to resolve to a specific adapter combination during development and testing, without editing source.

**Mechanism:**

- Environment variable `SOURDAW_CAPABILITY_OVERRIDE` (Vite/Node) and/or a URL query param in browser mode (`?capabilityOverride=…`) accept a JSON payload or a named preset (e.g. `webkit`, `chrome`, `browser-fallback`, `native-only`).
- Overrides are read **before** detection runs; when present they replace the detection output for the named domains and the registry is still frozen afterwards.
- Overrides are **rejected in production builds** — reading them requires `import.meta.env.DEV === true` or equivalent Tauri dev-build gate.
- The Capabilities panel renders a prominent "OVERRIDE ACTIVE" banner when an override is in effect.

**Acceptance criteria:**

- [ ] Setting `SOURDAW_CAPABILITY_OVERRIDE={"midi":"none"}` in dev causes the MIDI adapter to resolve to the "unavailable" variant and the UI to show the Safari-style message.
- [ ] Setting the same variable in a production build has no effect and a warning is logged.
- [ ] An override preset test covers `browser-fallback`, `native-only`, and `webkit` and asserts the resolved routing per domain.

---

## Constraints

- Must follow the domain-driven module architecture (`AGENTS.md` — Frontend Domain-Driven Architecture). The capability/registry code lives in its own module (proposed: `src/modules/Platform/`). Cross-module access is only through its root `index.ts`.
- No `useMemo` / `useCallback` / `React.memo` / `forwardRef`. The React Compiler handles memoization.
- No `&&` rendering in any UI surface introduced here (Capabilities panel).
- TypeScript soundness rules apply — no `any` at module boundaries, no `as unknown as` to erase adapter typing, no `@ts-ignore` without justification.
- No allocation, mutex locks, or blocking calls on the audio thread. The adapter layer never runs on the audio thread; the audio engine uses the Native Shadow pattern and talks to the UI via the R7 SAB ring buffer.
- No codemods or automated bulk mutations to migrate existing call sites (per `AGENTS.md`). Migration happens deliberately, one call site at a time.
- All adapter files are lazy-loaded; static `import` of a platform-specific adapter from outside `src/modules/Platform/` is forbidden.
- `pnpm deps:validate` passes with zero violations after every batch of cross-module changes.
- Adapter code may not import from `handlers/`, `models/`, or other private module internals (those are private per `AGENTS.md`). Data passed across the adapter boundary is plain domain-typed objects declared local to the Platform module.

### Tauri IPC and security boundaries

- **No real-time audio over IPC.** Real-time audio buffers MUST NOT cross the Tauri JS↔Rust IPC boundary; the native engine talks to hardware via `cpal`. The UI receives only metering, transport state, decimated waveform data, and control events at UI cadence (research §9).
- **Large binary transfer caveats.** `ArrayBuffer` transfer costs vary by platform (~5 ms on Windows vs ~200 ms on some configurations for a 10 MB payload per research §9). Features requiring high-frequency large-buffer IPC are forbidden; the R7 SAB ring buffer is the only sanctioned channel for sample-rate data.
- **No cross-platform `SharedMemory`/mmap** is currently safe to rely on across WebView2 / WKWebView / WebKitGTK — design features accordingly (research §9).
- **Forbidden Tauri command surfaces.** Commands MUST NOT accept arbitrary filesystem paths, offer unrestricted shell execution, expose generic raw USB/HID byte streams to the frontend, or run ad-hoc SQL against app databases. Scope-and-validate at the Rust boundary; the frontend deals in IDs (e.g. `loadProjectFile(projectId)`), not raw paths (research §9, §12).

---

## Design decisions

### Decision: Pattern B (Capability Adapter Layer) over Patterns A/C/E

**Chosen:** Central `CapabilityRegistry` that resolves one concrete adapter per domain at startup; components consume typed adapter interfaces only.

**Considered and rejected:**

- **Pattern A — scattered feature detection** (`if ('showOpenFilePicker' in window) …` at every call site). Rejected: unmaintainable at scale, creates inconsistent UX per call site, blocks code-splitting, and each new platform is a grep-and-patch exercise (research §7).
- **Pattern E — optimistic try/catch** (attempt the Chrome path, catch failure, fall through to Rust). Rejected: non-deterministic first-failure latency, inconsistent UX between cold and warm paths, and masks real errors. Unacceptable for a DAW where "why doesn't MIDI work the first time I launch?" is a production-quality bug.
- **Pattern C — full capability graph for every domain.** Kept in scope only for the audio engine routing (D6), where the interaction between WASM, native, and Web Audio genuinely requires a richer resolver. Using Pattern C across every domain is overengineered — most domains have exactly one resolved implementation per runtime.
- **Pure global platform check** (`if (isTauri) else`). Rejected: masks the sub-platform differences (WKWebView vs WebKitGTK have different Layer 2 behavior) and couples unrelated code through a single branching primitive.

### Decision: Registry is frozen after init

**Chosen:** `Object.freeze` the registry after the startup probe completes. No mid-session mutation.

**Considered and rejected:**

- **Mutable registry with invalidation events.** Rejected: a DAW session may last hours and involves active audio/MIDI streams. Swapping adapters underneath running streams is a correctness hazard with no user-visible benefit. Runtime environment changes (user launches desktop build instead of browser) are session boundaries, not in-session events.
- **Per-tab / per-window scoped registries.** Rejected: complicates the Tauri per-window security model unnecessarily for v1. All windows of one Sourdaw instance share one registry; per-window permissioning is handled by Tauri's capability ACL, not by this layer.

### Decision: Adapters are lazy-loaded, never statically imported

**Chosen:** Dynamic `import()` behind the registry factory.

**Considered and rejected:**

- **Static imports guarded by tree-shaking.** Rejected: bundler tree-shaking cannot reliably eliminate Tauri-specific adapters from the browser bundle because the Tauri SDK has side-effect imports. Dynamic import draws a hard boundary the bundler cannot cross.

### Decision: Branded handle types per adapter

**Chosen:** Every adapter's handle is a branded nominal type; cross-adapter handle mixing is a compile error.

**Considered and rejected:**

- **Shared structural `FileHandle` type.** Rejected: `TauriFileHandle` and `ChromeFileHandle` are structurally identical but operationally incompatible (a Tauri path cannot be passed to a Chrome FSA read). Branded types catch this at compile time rather than at runtime with a cryptic error.

### Decision: Device I/O (HID/Serial/USB/BLE) is Rust-only on desktop — no "Chrome accelerator"

**Chosen:** On Tauri desktop, Web device APIs are not used even as optional accelerators where available (e.g. Chrome/WebView2).

**Considered and rejected:**

- **Use Chrome device APIs on Windows/WebView2 for convenience.** Rejected on three grounds (research §§2.5–2.8, §6, §10): (1) browser-style chooser dialogs inside a desktop app are UX regressions; (2) WebView2's chooser rendering is documented-broken; (3) WebUSB excludes audio-class devices, which is exactly what a DAW would need. No performance gain exists to offset these costs.

---

## Acceptance criteria

Release gate for this spec. All items must be checked before the adapter layer is considered shipped.

- [ ] `CapabilityRegistry` module exists under `src/modules/Platform/` and exposes the frozen typed registry via its root `index.ts` only.
- [ ] Every domain D1–D7 has at least one adapter implementation per runtime path listed in R4.
- [ ] Every adapter has `__tests__/<adapter>.spec.ts` including a contract-conformance test.
- [ ] A shared contract suite per domain runs against every adapter and passes.
- [ ] Bundle-size audit: `pnpm build` of the browser entry yields **zero** files under `adapters/tauri/**`; `pnpm build` of the Tauri entry yields **zero** files under `adapters/chrome-only/**` on the WKWebView target. Audit runs in CI.
- [ ] COOP/COEP headers present in `tauri.conf.json` and `vite.config.ts`. `self.crossOriginIsolated === true` asserted in an integration test.
- [ ] A SAB-unavailable integration test verifies the degraded-mode registry field and confirms the app boots without throwing.
- [ ] Startup detection latency ≤ **50 ms** on desktop, ≤ **20 ms** in browser (measured, not estimated).
- [ ] Dev-mode override flag works in dev builds and is ignored in production builds, verified by test.
- [ ] Capabilities panel is reachable from settings and renders the resolved adapter per domain, the source layer, and any override banner.
- [ ] `pnpm deps:validate` passes with zero violations.
- [ ] `pnpm typecheck` passes with zero errors. No `any`, `as unknown as`, or `@ts-ignore` added to this module.
- [ ] ESLint rule: direct feature-detection calls (`'foo' in window`, `navigator.requestMIDIAccess`) outside `src/modules/Platform/` fail lint.

---

## Implementation notes

- **Module placement.** `src/modules/Platform/` is the proposed home. The module's root `index.ts` exports only: the frozen `registry` getter, the typed capability interfaces, branded handle types, and the adapter-resolution functions. Adapters under `adapters/<runtime>/<domain>.ts` are private.
- **One function per file rule** (`AGENTS.md`) applies to any use cases added in this module (e.g. `detectCapabilities.ts`, `resolveMidiAdapter.ts`).
- **No barrel within adapters/**. Consumers inside the module use relative imports to specific adapter files. The root `index.ts` is for *other* modules.
- **Detection order matters.** Read `window.__TAURI_INTERNALS__` first; platform identity determines which of the WebKit-specific absent-API sets applies.
- **Branded types.** Use `type Brand<Name extends string, T> = T & { readonly __brand: Name }` in `utils/brand.ts` if not already present. Do not reinvent.
- **Error types.** Use discriminated unions: `type AdapterError = { kind: 'unsupported'; domain: string } | { kind: 'permission-denied'; … } | …`. Narrow at consumers.
- **Where Rust capability metadata comes from.** The Tauri-side `capability::probe` command should return only already-available data (plugin registration status, platform identity, granted entitlements) — no side effects, no prompts, no I/O that could block the 50 ms budget.
- **Audio engine special case.** D6 does not route through the generic factory. The audio module owns its Native Shadow construction; the registry just exposes `audioEngine: { mode: 'native' | 'wasm' }` as a readable tag for the Capabilities panel.
- **Migration.** Existing call sites that hit web APIs directly are *not* migrated as part of this spec. Each consuming module migrates in its own task. This spec lands the layer and one reference migration (recommend: MIDI, since it's the most consequential gap).
- **Frontend command design principle (research §12).** Tauri commands and adapter methods accept **opaque IDs** (`loadProjectFile(projectId)`) rather than raw paths or raw byte streams. This keeps sandboxing, validation, and permissioning on the Rust side; the frontend does not know, and does not need to know, filesystem layout.
- **Permission prompt timing (research §12.2).** Defer permission prompts to the first user action that actually needs them (MIDI, audio input, file pick). The startup probe must not trigger prompts.
- **Tauri placement rules (research §9).** Cross-cutting platform glue lives in a Tauri plugin. App-local commands live under `#[tauri::command]` in `src-tauri/src/commands/`. Out-of-process binaries (VST hosting, heavyweight subprocesses) live as a sidecar with heartbeat/restart supervision — those are out of scope here, but the adapter layer must not reach into sidecars directly.
- **Phase roadmap reference (research §15, informative).** Research suggests phased delivery (1 = detection + Tauri-first filesystem/MIDI; 2 = OPFS autosave + audio engine; 3 = Chrome FSA accelerator + device APIs; 4 = polish). This spec does not lock the phasing; it is recorded here as a starting point for the implementation task.

---

## Test plan

- [ ] **Unit: detection.** Fake each detection input; assert the resolved registry matches the expected per-runtime profile for Tauri/Win, Tauri/macOS, Tauri/Linux, Browser/Chrome, Browser/Safari, Browser/Firefox.
- [ ] **Unit: freezing.** After init, mutating any field throws.
- [ ] **Unit: override flag.** Dev build honors the flag and rewrites the resolved profile; production build ignores it.
- [ ] **Unit: branded types.** Type-only test using `expectTypeOf` ensures `TauriFileHandle` is not assignable to `OPFSFileHandle`.
- [ ] **Per-adapter integration.** Each adapter runs its contract suite against a minimal fake platform surface (e.g. a fake `navigator.requestMIDIAccess`, a fake `tauri::invoke` responder).
- [ ] **Bundle audit.** `pnpm build:browser` and `pnpm build:tauri` followed by a script that greps the emitted chunk graph for forbidden adapter paths.
- [ ] **COOP/COEP.** Headless browser integration test loads the built app and asserts `self.crossOriginIsolated === true`.
- [ ] **Startup-timing test.** `performance.now()` delta across `detectCapabilities()` ≤ 50 ms (desktop) / 20 ms (browser). Runs on CI on each platform.
- [ ] **Platform-matrix CI.** A GitHub Actions job matrix runs the test suite on `ubuntu-latest` (WebKitGTK via Tauri dev), `macos-latest` (WKWebView), and `windows-latest` (WebView2). Tests that require full desktop webview isolation may be marked `@requires-gui` and gated to the matrix job.
- [ ] **Capabilities panel manual check.** Launch on each of the three desktop platforms; open the panel; confirm the resolved adapter per domain matches R4.
- [ ] **Dev override manual check.** Set `SOURDAW_CAPABILITY_OVERRIDE={"midi":"none"}`; launch dev build; confirm MIDI device list surfaces the "unavailable" state; confirm override banner is shown.

---

## Open questions

- [ ] **[CRITICAL]** Which File System Access persistence strategy does the Chrome/Windows D1 adapter use? The research (§§2.2, 3) documents that `FileSystemDirectoryHandle` can be cached in IndexedDB but **permissions do not persist across sessions** — the user must re-grant every launch — and that WebView2's `PermissionRequested` event does not consistently surface FSA prompts, so the usual host UI interception cannot be relied on. Options: (a) silently re-request with user prompt on each launch; (b) drop the FSA adapter entirely on Tauri/Windows and always use Tauri scoped fs; (c) use FSA only for in-session subsequent reads after the initial Tauri-dialog grant. This choice decides whether FSA ships as an optional Windows enhancement at all. Must be decided before D1 implementation starts.
- [ ] **[MAJOR]** For non-Chrome WebKit / Firefox **browser-only** users, does Sourdaw degrade (with the Capabilities panel showing missing features) or actively **block** launch with a "use the desktop app or Chrome" message? Affects R2 adapter set and the UX of the missing-capability surfaces. Proposed default: degrade, not block — but the product call is not made yet.
- [ ] **[MAJOR]** Does the Capabilities panel ship in v1 of this layer, or as a follow-up once the adapters exist? The acceptance criteria currently require it. If cut, R1/R3 acceptance criteria that depend on it must be reworded to require the data structure without requiring the UI surface.
- [ ] **[MINOR]** Is `credentialless` COEP acceptable as a default instead of `require-corp`? The research (§16) notes it is needed if third-party assets cannot be self-hosted. Current default in this spec is `require-corp` with `credentialless` as a documented fallback. Confirm whether Sourdaw loads any cross-origin resource that forces `credentialless`.
- [ ] **[MINOR]** Should D8 (GPU compute/visualization) be a full adapter (symmetric to D1–D6) or a thinner renderer-selector? The research supports either; this spec leans toward "thin selector" because WebGPU and WebGL2 share no meaningful handle types.

---

## Tradeoffs and risks

- **Frozen-at-init is deliberately rigid.** If a future feature genuinely needs runtime swap (e.g. hot-attach of a debug backend), it will not fit this spec and will require an explicit rework — not an escape hatch.
- **Detection budget is tight.** The 50 ms / 20 ms budget depends on no adapter doing I/O at probe time. If a future adapter probes something expensive (e.g. enumerating MIDI devices to see whether any exist), the budget breaks. The rule is: probe API *presence* only; enumerate capabilities on demand later.
- **Bundle audit can become brittle.** If bundler internals change the emitted chunk graph, the grep-based audit may false-positive. Treat it as a guardrail, not a perfect barrier; the ESLint rule on forbidden static imports is the primary defense.
- **WKWebView OPFS 10 MB limit is a trap.** D1 routing correctly handles this by keeping OPFS for autosave only, but any new adapter that tries to store audio data in OPFS on macOS will silently cap out. The D1 OPFS adapter must enforce the limit at write time and surface an `AdapterError { kind: 'unsupported' }` — not an I/O error — so consumers branch correctly.
- **WebKitGTK version fragmentation** (research §16 risk) means the Linux adapter profile is effectively "WebKitGTK ≥ 2.44". Older distros will degrade further; the probe must record the WebKitGTK version when detectable and surface it in the Capabilities panel for support triage.
- **Dev override flag could leak into QA surfaces.** Ensure CI uses production builds for release validation so QA never runs with an override accidentally in effect.
- **Pattern B centralises all platform logic in one module.** A bad change in `src/modules/Platform/` affects every domain. Mitigate with the shared contract test suite (R6) and platform-matrix CI (test plan).
- **WKWebView backgrounding stops audio.** macOS WKWebView can stop audio when the app is backgrounded (research §§11, 16). Wire AudioContext `suspend`/`resume` to window focus/blur at the audio-engine layer; this is product-critical even though it is not an adapter concern.
- **macOS code signing and microphone entitlements.** Native audio input paths (`cpal`) require correct entitlements and `NSMicrophoneUsageDescription` — track as a release checklist item; tauri#9928 and related issues document the failure mode (research §16).
- **Web Share is broken on WebView2.** Do not rely on `navigator.share` for desktop flows on Windows (research §2.15, support matrix). If sharing UX is needed, route through a Rust command.
- **IndexedDB ~100 MB record cliff.** Large binary records in IDB degrade sharply beyond ~100 MB on some engines (research §13.4). Use OPFS on supported runtimes or Tauri-native storage for large project/model caches; do not rely on IDB alone for multi-hundred-MB assets.
- **Storage quota split across runtimes.** Chromium WebView2 typically allows ~60 % of free disk; WKWebView non-browser ~15 % (research §§2.16, 11). Plan model / sample / project caches against the smaller figure when targeting all three runtimes.
- **MIDI-class HID surfaces are not pure MIDI.** Some control surfaces (Mackie/HUI variants) transport control data over HID rather than MIDI (research §13.2). D4 and D5 can cross-reference a shared transport layer where helpful; treat this as a known consideration rather than two fully independent silos.

## Implementation Status

**What is implemented:**
- None of the explicit Capability Adapter Layer architectures exist yet. The `src/modules/Platform` module is absent.
- Capabilities are currently resolved via ad-hoc checks directly at the call sites across the codebase.

**What is not implemented:**
- The frozen `CapabilityRegistry` singleton.
- Centralized detection of platform shape at startup.
- Concrete `CapabilityAdapter` implementations for domains D1 through D8.
- Branded handle types for file operations.
- Capabilities UI panel in settings.
- The dev-mode capability override flag (`SOURDAW_CAPABILITY_OVERRIDE`).
- Dedicated testing and contract tests for the adapter layers.

**What is done well:**
- N/A (The spec is unimplemented).

**What needs refactoring:**
- Existing scattered platform checks must be migrated into this adapter architecture once it is scaffolded.
- Tauri IPC implementations and file/device handling currently bypassing this proposed layer will need adaptation to use the `CapabilityAdapter` interface.
