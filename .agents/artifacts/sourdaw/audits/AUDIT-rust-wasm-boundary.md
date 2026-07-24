---
type: audit
id: AUDIT-rust-wasm-boundary
scope: Rust/WASM boundary — build pipeline, generated-artifact management, wasm instantiation in AudioWorklets, JS↔wasm and JS↔Tauri IPC copy, panic handling, toolchain reproducibility, type drift
branch: audit/rust-wasm-boundary
base: origin/main @ 74eb3061d0f91c80584c6264dec0907ed29935a0
method: sus-audit (observe, prove, prescribe nothing) + tauri-platform skill
---

# Rust/WASM Boundary Audit

Audit-only. Every observation is anchored to `file:line`, a pasted command result, or a whole-scope
search. Remediations in the roadmap are options, not accepted work.

Repository frozen at detached `origin/main` = `74eb3061d0f91c80584c6264dec0907ed29935a0`.

---

## 1. Golden Standard (research first)

First-class practice for a Rust→WASM + Tauri boundary, with authoritative citations.

### 1.1 wasm-bindgen ABI is unstable — glue and binary must be built together, exactly paired

The wasm-bindgen "bindgen format" (schema) is explicitly unstable: the generated JS glue and the
`_bg.wasm` binary carry a matching schema version, and **the two must match exactly** or init throws
`function import requires a callable` / `imported ... does not exist`. The canonical error text: "the
Rust project used to create this wasm file was linked against a version of wasm-bindgen that uses a
different bindgen format than this binary" — resolved only by aligning the crate's `wasm-bindgen`
dependency and the `wasm-bindgen-cli` used to generate the glue. A pair produced by different
toolchains silently drifts. Therefore checked-in `_bg.wasm` + glue must be regenerated as an atomic
unit, and a monorepo should **fingerprint the generated artifacts against crate source in CI** so a
stale hand-committed pair cannot ship.
- wasm-bindgen version-mismatch (schema must match): https://github.com/rustwasm/wasm-bindgen/issues/2619 ,
  https://github.com/wasm-bindgen/wasm-bindgen/discussions/3684
- Unstable "wasm" ABI tracking issue: https://github.com/rust-lang/rust/issues/83788

### 1.2 wasm-bindgen deployment: `--target web` + `initSync` with pre-fetched bytes; the default async init resolves `new URL('..._bg.wasm', import.meta.url)`

The Deployment guide documents that `--target web` glue exposes a default async `init` that fetches
`new URL('name_bg.wasm', import.meta.url)`, and a synchronous `initSync(module)` that takes an already
compiled/fetched module — the correct choice inside an AudioWorklet where async top-level fetch is not
available and bytes are transferred in via `postMessage`. First-class practice: fetch/compile **once**
and reuse; never leave the async default's relative `import.meta.url` path pointing at a location a
bundler will resolve to a stale co-located artifact.
- Deployment: https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html
- Wasm Audio Worklet example: https://wasm-bindgen.github.io/wasm-bindgen/examples/wasm-audio-worklet.html

### 1.3 Panic handling across the boundary — `console_error_panic_hook`, panic=abort awareness

On `wasm32-unknown-unknown` a Rust panic compiles to a trap (`unreachable`); without
`console_error_panic_hook` (or `std::panic::set_hook`) the JS side sees only
`RuntimeError: unreachable executed` with no message, and the wasm **instance is poisoned** — every
subsequent exported call fails. Production wasm should install the hook (guarded/lightweight) so panics
surface a diagnostic, and boundary code should treat a trapped instance as unrecoverable rather than
silently dead. wasm-bindgen additionally exposes `--abort-on-uncaught-exception` machinery.
- console_error_panic_hook rationale (wasm-bindgen guide / crate): https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html

### 1.4 Tauri v2 IPC — JSON by default; use `ipc::Response`/`Channel`/raw request body for bytes

Tauri v2 command arguments and return values are serialized to **JSON by default** (args
`serde::Deserialize`, returns `serde::Serialize`). Passing a `Uint8Array` as `Array.from(bytes)`
produces a JSON **number array** — several × the raw byte size plus a serialized-string copy. For bytes,
Tauri v2 provides zero-JSON paths: `tauri::ipc::Response::new(Vec<u8>)` for returns, an `ArrayBuffer`/
`Uint8Array` raw **request body** for sends, and `Channel<&[u8]>` for streamed/ongoing data. "It already
takes ~200 ms to send only 3 MB of data over IPC" when serialized as JSON; raw octet-stream / `DataView`
reads are near-instant.
- Calling Rust from the Frontend (ipc::Response, Channel, raw body): https://v2.tauri.app/develop/calling-rust/
- IPC serialization / large-payload behaviour: https://deepwiki.com/tauri-apps/tauri/3-ipc-and-communication

### 1.5 Reproducible builds & memory strategy

Reproducible Rust→wasm requires a locked toolchain **and** a pinned artifact toolchain: `wasm-pack`,
its bundled `wasm-opt` (binaryen), and the `wasm-bindgen-cli` all affect binary bytes and the schema
version; a caret crate range or a floating CLI defeats reproducibility. WebAssembly linear memory
declared with no maximum grows unbounded on demand; `memory.grow()` allocates — never acceptable on a
real-time audio thread. Practice: bound growth, prefer compile-once module reuse, and keep growth out of
the render callback.
- WebAssembly.Memory / linear memory growth: https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/Memory

---

## 2. Current-State Map

### 2.1 Build pipeline (`package.json:32-36`)
- `wasm:dsp` → `cd crates/daw-dsp && wasm-pack build --target web --out-dir ../../public/wasm/daw-dsp && rm -f .gitignore && node scripts/gen-daw-dsp-worklet.ts`
- `wasm:proof-chamber`, `wasm:scoring` (`--no-typescript`), `wasm:decoder` (`--no-typescript`, no gen script)
- `wasm:all` chains the four. **No `wasm-pack`/`wasm-opt` version pin anywhere.**

### 2.2 Generated-artifact locations (all git-tracked)
- `public/wasm/{daw-dsp,proof-chamber,scoring,daw-wasm-decoder}/` — the served binaries + wasm-pack glue + generated `.d.ts`.
- `src/modules/AudioEngine/wasm/` — the transformed glue (`daw_dsp.js`, `proof_chamber.js`, `scoring.js`), hand/partly-maintained `.d.ts`, **and a stale `daw_dsp_bg.wasm`**.
- `git ls-files` confirms every file above is tracked. `src/modules/AudioEngine/wasm/.gitignore` contains **only a comment** ("Keep generated WASM bindings tracked") — it ignores nothing.

### 2.3 Glue transform (`scripts/gen-daw-dsp-worklet.ts`, `gen-proof-chamber-worklet.ts`, `gen-scoring-worklet.ts`)
- Reads `public/wasm/<pkg>/<pkg>.js`, prepends AudioWorklet polyfills (TextDecoder/TextEncoder/FinalizationRegistry), rewrites the async-init default path, writes to `src/modules/AudioEngine/wasm/<pkg>.js`.
- Rewrite is a single unguarded `String.replace("module_or_path = new URL('<pkg>_bg.wasm', import.meta.url);", "module_or_path = '/wasm/<pkg>/<pkg>_bg.wasm'; // served from public/")`. Confirmed in src glue: `daw_dsp.js:1480`, `proof_chamber.js:339`, `scoring.js:392`.
- Only `gen-proof-chamber-worklet.ts:26-27` copies the `.d.ts`; `daw-dsp` and `scoring` gen scripts copy only the `.js`.

### 2.4 initSync consumers
- Worklet processors (`src/modules/AudioEngine/services/*Processor.ts`) import `initSync` from `../wasm/*.js` (fermenter, proof, gluten, toaster, bacteria, grinder, levain, knead, scoringProcessor, proofChamberProcessor).
- `workers/grandBouleEngineWorker.ts:27` imports `initSync`.
- Main-thread pitch useCases import wasm fns **directly**: `useCases/audioAnalysis/analyzePitchForClip.ts:3` (`analyze_pitch_wasm`), `processPitchEditWasm.ts:2` (`commit_pitch_edit_wasm`).
- Bytes are sourced by the engine nodes via `fetch('/wasm/daw-dsp/daw_dsp_bg.wasm')` (`engine/*Node.ts` `DEFAULT_WASM_URL`), cached per URL by `src/infra/audioWorklet/workletInitShared.ts` `fetchWasmBinary`. The src glue's rewritten async default also points at `/wasm/daw-dsp/daw_dsp_bg.wasm` (`daw_dsp.js:1480`), so the main-thread pitch path loads the **public** binary too.
- Test `wasm/__tests__/dawDspToasterAutomation.spec.ts:10-11` reads `public/wasm/daw-dsp/daw_dsp_bg.wasm` and `initSync`s the src glue.

### 2.5 Boundary types
- `public/wasm/daw-dsp/daw_dsp.d.ts` (25 093 B, wasm-pack generated, 25 exports incl. all `*Instance` classes) vs `src/modules/AudioEngine/wasm/daw_dsp.d.ts` (7 118 B, hand-authored — `default_init`, custom `WasmExports = { memory }` subset, `export declare` style).

### 2.6 Tauri IPC (register OE-5 / M-109)
- Sole TS adapter `src/utils/tauriBridge.ts` (`tauriInvoke:22`, `tauriListen:30`, `createChannel:61`). `createChannel` (binary streaming) is exposed but unused by the export path.
- `src/modules/AudioRendering/repositories/audioExport/writeNativeAudioStemFile.ts:18` and `writeNativeAudioMixdownFile.ts:17`: `invoke('write_audio_file', { data: Array.from(bytes) })`.
- Rust `src-tauri/src/commands/filesystem.rs:32` `write_audio_file(path, data: Vec<u8>)`; `:26` `read_audio_file -> Result<Vec<u8>>`; `commands/plugins.rs:610` `audio_bytes: Vec<u8>`, `:482` `plugin_state: Vec<u8>`, `:450/:612` `-> Result<Vec<u8>>`.

### 2.7 Panic / profile / toolchain
- No `console_error_panic_hook`/`set_hook`/`panic::set_hook` anywhere in `crates/` (whole-scope grep empty).
- Root `Cargo.toml:16-18` `[profile.release] opt-level=3, lto=true` — **no `panic="abort"`**. Crate `Cargo.toml`s declare only `crate-type`.
- `rust-toolchain.toml`: `channel = "nightly-2026-04-14"`, minimal + rustfmt/clippy. `Cargo.lock` pins `wasm-bindgen 0.2.126`; `crates/daw-dsp/Cargo.toml:11` declares `wasm-bindgen = "0.2"` (caret). No `wasm-pack`/`wasm-opt` pin.

### 2.8 CI
- `.github/workflows/health-gates.yml`: two jobs (web app + collaboration server). Web job runs `pnpm test:health-gates` then `scripts/health-gates-web.sh` = `deps:validate`, `typecheck`, `typecheck:test`, `lint --quiet`, `test:run`, `build` (`health-gates-web.sh:37-42`). **No `cargo`, no `wasm-pack`, no wasm rebuild/verify step.** No husky/pre-commit hooks (none configured). Whole-repo search for any wasm freshness/drift verification: no gate found (only `target/` build fingerprints and one incidental spec string).

### 2.9 wasm-bindgen symbol pairing (verified — `grep -ao '__wb..._..._<16hex>'`)
| file | schema hash |
|---|---|
| `public/wasm/daw-dsp/daw_dsp.js` | `344f42d3211c4765` |
| `public/wasm/daw-dsp/daw_dsp_bg.wasm` | `344f42d3211c4765` |
| `src/modules/AudioEngine/wasm/daw_dsp.js` | `344f42d3211c4765` |
| **`src/modules/AudioEngine/wasm/daw_dsp_bg.wasm`** | **`5549492daedad139`** ← mismatch |
| public+src `proof_chamber.js`, public+src `scoring.js` | `344f42d3211c4765` (all consistent) |

wasm memory sections (parsed): all four public binaries + the stale src binary declare `flags=0` →
**no maximum (unbounded growth), non-shared**; min 17 pages (~1 MB) for dsp/proof/scoring, 20 pages
(~1.25 MB) for the decoder.

Dead dirs `public/wasm/gluten` + `public/wasm/dutch-oven` from the #657 incident: **removed** (not on
disk, not tracked). #657 = commit `59b241ee4 fix(audio): load Gluten from the canonical daw-dsp build`.

---

## 3. Findings

Severity: Blocker / Major / Minor / Polish. Size: S / M / L.

### WB-1 — No CI or pre-commit gate verifies committed wasm artifacts match crate source; the #657 drift class will recur — **Major, M**

Status: FIXED in #721
- **Evidence:** `.github/workflows/health-gates.yml`, `scripts/health-gates-web.sh:37-42` (no cargo/wasm-pack); whole-repo drift-verification search empty; no husky/pre-commit.
- **Failure mode:** a crate change lands without `pnpm wasm:all`, or an artifact is edited by hand, and the committed `public/wasm` + `src` glue no longer correspond to `crates/` source. Nothing rebuilds and diffs them.
- **Firing condition:** any Rust DSP edit merged without a matching regenerated-artifact commit — the routine case, since artifacts are hand-committed.
- **Blast radius:** silent schema drift ships to production; the class already fired once as #657. A fingerprint gate would rebuild `wasm:all` in CI and fail on any `git diff` in `public/wasm` + `src/modules/AudioEngine/wasm`.

### WB-2 — Stale, schema-mismatched `src/modules/AudioEngine/wasm/daw_dsp_bg.wasm` still checked in — **Major, S**

Status: FIXED in #721
- **Evidence:** §2.9 pairing — this binary is `5549492daedad139` while the glue beside it, the public glue, and the public binary are all `344f42d3211c4765`. `git ls-files` tracks it (363 880 B, a different build from the public 501 787 B).
- **Failure mode:** it is a mismatched twin of the live binary. No current path loads it (async default rewritten to `/wasm/daw-dsp/` at `daw_dsp.js:1480`; test reads the public binary; nothing imports the co-located file), so today it is 363 KB of dead tracked weight — **and** the live trap for WB-3: if the glue rewrite ever no-ops, the async default falls back to `new URL('daw_dsp_bg.wasm', import.meta.url)`, resolving to *this* `5549` binary → `initSync` throws `function import requires a callable` — the #657 failure verbatim.
- **Firing condition:** WB-3 silent no-op, or any bundler/import that resolves the co-located file.
- **Blast radius:** contradicts `gen-daw-dsp-worklet.ts`'s own comment ("it doesn't exist there — it lives in public/"). Removal + a real `.gitignore` entry closes it.

### WB-3 — Glue transform is an unguarded string `.replace()` with no success assertion — **Major, S**

Status: FIXED in #721
- **Evidence:** `scripts/gen-daw-dsp-worklet.ts` (`generated.replace("module_or_path = new URL('daw_dsp_bg.wasm', import.meta.url);", …)`), same shape in `gen-proof-chamber-worklet.ts:79`, `gen-scoring-worklet.ts:76`.
- **Failure mode:** `String.replace` returns the input unchanged when the needle is absent. wasm-bindgen has changed the exact generated init line across 0.2.x (quoting, spacing, variable name). On any such change the rewrite silently no-ops, the async default keeps `new URL('..._bg.wasm', import.meta.url)`, and the co-located (stale) binary path ships.
- **Firing condition:** a `wasm-bindgen`/`wasm-pack` CLI bump that alters the init line.
- **Blast radius:** re-arms WB-2 across all three packages with no error at generate time; only detectable as a runtime trap. No match-count check, no throw-on-zero-replacements.

### WB-4 — `.d.ts` type drift: `daw_dsp`/`scoring` src declarations are hand-maintained and never regenerated — **Major, M**

Status: FIXED in #733 — generation now emits every wasm package’s `.d.ts` and copies it into the `src/modules/AudioEngine/wasm` worklet mirror (`wasm:scoring` dropped `--no-typescript`; the `daw-dsp`/`scoring` gen scripts copy + stamp the declarations as proof-chamber already did), so no hand-maintained declaration mirror remains. The regenerated contract replaced the drifted mirrors — the hand `daw_dsp.d.ts` had declared a nonexistent `default_init`, omitted `init_panic_hook`, and tightened `commit_pitch_edit_wasm` to `Float32Array<ArrayBuffer>`; its one call site was corrected to the real `Float32Array` return. typecheck stays 0.

- **Evidence:** `gen-daw-dsp-worklet.ts` / `gen-scoring-worklet.ts` copy only the `.js`; only `gen-proof-chamber-worklet.ts:26-27` copies the `.d.ts`. `src/modules/AudioEngine/wasm/daw_dsp.d.ts` head is hand-authored (`default_init`, `WasmExports` subset; 17 exports) vs generated `public/wasm/daw-dsp/daw_dsp.d.ts` (25 exports incl. every `*Instance`).
- **Failure mode:** a crate API change (new/renamed method, changed signature) updates the generated public `.d.ts` but leaves the hand-authored src `.d.ts` stale. TS type-checks green against the wrong contract; the mismatch surfaces only as a runtime wasm error.
- **Firing condition:** any change to a `#[wasm_bindgen]` method signature in `daw-dsp`/`scoring`.
- **Blast radius:** the #635 "keep DSP types reproducible" concern, live. The compiler — the one thing meant to catch FFI drift — is compiling against a manually mirrored shape.
- **Verifier blind spot (evidence from #732):** `wasm:verify` couples a crate-source-hash change to *some* artifact change in the package, but cannot detect a single artifact **type** going stale within a regenerated package. In #732 the scoring crate changed and its `.js`/`_bg.wasm` regenerated (hashes updated), yet `--no-typescript` plus a `.js`-only gen script left all three scoring `.d.ts` byte-identical — missing the new `get_nan_flush_count` export — and the fingerprint gate still passed. The `.d.ts` were corrected by hand in #732; closing the generation gap (regenerate/copy the `.d.ts`) was WB-4’s scope. **Closed in #733:** every generated `.d.ts` now carries a crate-source provenance stamp (`// @wasm-bindgen-dts crate-source: sha256:…`) that `wasm:verify` re-derives the live crate hash and asserts against, so a declaration left stale while its crate (and `.js`/`_bg.wasm`) regenerated fails the gate even though every byte hash is self-consistent in the freshly written manifest. The stamp is provenance-only: it proves the crate source is unchanged since the `.d.ts` was generated, not that the file's content matches the bindings (only regeneration proves that) — a hand-forged stamp over a stale body plus a rebuilt manifest still passes clean, an inherent limit of disk-derived checks.

### WB-5 — Native byte payloads use `Array.from(bytes)` → JSON number-array inflation (registers OE-5 / M-109; still live, broader) — **Major, M**
- **Evidence:** `writeNativeAudioStemFile.ts:18`, `writeNativeAudioMixdownFile.ts:17` (`data: Array.from(bytes)`); Rust `filesystem.rs:32` `Vec<u8>`. Return-path twins: `read_audio_file` (`filesystem.rs:26`) and plugin `audio_bytes`/`plugin_state` (`plugins.rs:610,482,450,612`) all `Vec<u8>` over JSON. `tauriBridge.ts:61` already exposes `createChannel`, unused here.
- **Failure mode:** Tauri v2 serializes command args to JSON by default (§1.4); `Array.from` boxes the `Uint8Array` into a `number[]`, so a multi-minute stereo WAV (tens of MB) becomes a huge JSON array plus a serialized-string copy — several × the raw payload, a large transient allocation, and a JSON parse on each side.
- **Firing condition:** every native stem/mixdown export and every native audio/plugin-state read.
- **Blast radius:** memory/throughput cliff on large exports; Tauri's zero-JSON paths (`ipc::Response`, raw `ArrayBuffer` request body, `Channel<&[u8]>`) are available and partly wired but unused. Argued from serialization shape, not measured (see Open Questions).

### WB-6 — Production wasm has no panic hook and no explicit `panic="abort"`; Rust panics surface as opaque traps that poison the instance — **Major, S/M**

Status: FIXED in #732 — `console_error_panic_hook` is installed at each wasm crate's init (daw-dsp, proof-chamber, scoring, daw-wasm-decoder), scoped to the wasm target so the native build is unaffected. `wasm32-unknown-unknown` is already `panic-strategy = "abort"` (verified via `--print target-spec-json`), so panics now fail loudly and identifiably; `panic = "abort"` is deliberately **not** set on the shared release profile (Cargo cannot scope it per-target — it would also switch the native Tauri build to abort), a choice documented inline in `Cargo.toml`. Paired with DSP-8's boundary guard, whose flush counter is exposed at the wasm boundary via `get_nan_flush_count()` with TS-side surfacing deferred to RT-10 (Wave 6).
- **Evidence:** whole-scope grep of `crates/` for `console_error_panic_hook`/`set_hook`/`panic::set_hook` — empty. Root `Cargo.toml:16-18` sets `opt-level`/`lto` only, no `panic="abort"`.
- **Failure mode:** on `wasm32-unknown-unknown` a panic traps to `unreachable`; the JS boundary sees `RuntimeError: unreachable executed` with no message, and the instance is poisoned — every later exported call throws. On the AudioWorklet render thread the device goes silent with no diagnostic.
- **Firing condition:** any panic in DSP under extreme input — index/slice bounds, `unwrap`, or a NaN/Inf-driven arithmetic assert (compounds DSP-8: no NaN/Inf boundary guard, `AUDIT-dsp-engines.md:186`).
- **Blast radius:** unobservable production audio-thread death; no hook to report, no boundary handling that treats a trapped instance as unrecoverable vs merely "not ready".

### WB-7 — wasm linear memory is unbounded and non-shared; per-worklet instances each compile the module and own a growing ~1 MB+ memory — **Minor, M/L**
- **Evidence:** §2.9 memory parse (all binaries `flags=0`, no max, non-shared). Each `*Processor` calls `initSync` independently; `workletInitShared.ts` caches fetched *bytes* per URL but not a compiled `WebAssembly.Module`, and a compiled module cannot be shared into a worklet anyway → N independent compiles of the ~490 KB daw-dsp module + N growable memories.
- **Failure mode:** no growth ceiling means a runaway/large allocation grows memory without bound; `memory.grow()` allocates — RT-unsafe if it ever fires inside `process()` (web-audio-engine skill: no allocation on the audio thread). N-device sessions pay N× compile + N× resident memory.
- **Firing condition:** many simultaneous wasm devices; any DSP that grows its heap during processing.
- **Blast radius:** memory pressure and instantiation cost scale linearly with device count; no `-Cmax-memory`/`maximum` bound and no shared-memory strategy. Instantiation compile is off the render callback (setup only), so not a per-block RT hazard today.

### WB-8 — Toolchain reproducibility gap: `wasm-pack`/`wasm-opt` unpinned; crate `wasm-bindgen` is caret `"0.2"` — **Minor, S**

Status: FIXED in #721
- **Evidence:** `rust-toolchain.toml` pins nightly (good); `Cargo.lock` pins `wasm-bindgen 0.2.126`; but `crates/daw-dsp/Cargo.toml:11` declares `wasm-bindgen = "0.2"`, and no `wasm-pack`/`wasm-opt`/`wasm-bindgen-cli` version appears in `package.json` or CI.
- **Failure mode:** the glue is generated by whatever `wasm-pack` (and its bundled `wasm-bindgen-cli`/`wasm-opt`) is on the developer's PATH. A CLI whose bundled `wasm-bindgen` ≠ the locked `0.2.126` produces the exact schema-version mismatch of §1.1; differing `wasm-opt` makes the binary non-byte-reproducible.
- **Firing condition:** two developers (or dev vs CI, if wasm ever builds in CI) with different `wasm-pack` installs.
- **Blast radius:** reintroduces drift at the source of generation — the upstream of WB-1/WB-2.

### WB-9 — AudioWorklet `TextDecoder` polyfill is latin1-only, not UTF-8 — **Polish, S**
- **Evidence:** `gen-daw-dsp-worklet.ts` polyfill block (and the sibling gen scripts): `decode` does `String.fromCharCode(bytes[i])` per byte; `encode` masks `& 0xff`.
- **Failure mode:** any multi-byte UTF-8 crossing the boundary (e.g. non-ASCII inside a JSON string returned by `analyze_pitch_wasm`, or a device param name) is corrupted.
- **Firing condition:** non-ASCII content in a wasm↔worklet string. Current payloads are ASCII, so latent.
- **Blast radius:** silent string corruption if payloads ever include non-ASCII; no error raised.

---

## 4. Remediation Roadmap (options, not accepted work)

Ordered by leverage. First-class only.

1. **WB-1 + WB-8 — artifact fingerprint gate (root cause).** Add a CI job that runs `pnpm wasm:all` on a pinned `wasm-pack`/`wasm-opt`/`wasm-bindgen-cli`, then fails if `git diff --exit-code -- public/wasm src/modules/AudioEngine/wasm` is non-empty. Pin the CLI trio (e.g. `cargo binstall wasm-pack@X`, `wasm-opt` version) and change `crates/daw-dsp/Cargo.toml` `wasm-bindgen` to the exact locked version. Size M. Closes the recurrence class.
2. **WB-2 — remove the stale binary.** Delete `src/modules/AudioEngine/wasm/daw_dsp_bg.wasm`; add a real ignore entry so no `_bg.wasm` is ever tracked under `src/`. Size S.
3. **WB-3 — assert the rewrite.** In each gen script, verify the needle matched exactly once (count replacements; throw on zero). Size S. Removes the silent-no-op path.
4. **WB-4 — regenerate the `.d.ts`.** Copy the generated `.d.ts` in the `daw-dsp`/`scoring` gen scripts as proof-chamber's already does (or generate a thin re-export), so the compiled contract tracks the crate. Size M.
5. **WB-6 — panic visibility.** Install `console_error_panic_hook` in each wasm crate's init, set `panic="abort"` explicitly for the wasm profile, and have boundary code treat a trapped instance as unrecoverable (surface, not swallow). Size S/M.
6. **WB-5 — byte IPC.** Return `tauri::ipc::Response` for `read_audio_file`/plugin reads; send `write_audio_file` payloads as a raw `ArrayBuffer`/`Uint8Array` request body (or `Channel`) instead of `Array.from(bytes)`. Size M.
7. **WB-7 — memory strategy.** Set a `maximum`/`-Cmax-memory` bound; keep the compile-once posture explicit and documented; confirm no growth path runs inside `process()`. Size M/L.
8. **WB-9 — UTF-8 polyfill.** Replace the latin1 polyfill with a real UTF-8 decoder/encoder, or feature-detect and fail loudly. Size S.

---

## 5. Open Questions

- **WB-5 is argued from serialization shape, not measured.** No profiling of actual export IPC time/allocation was run in this audit (matches the OE-5 caveat in `AUDIT-offline-export.md`). A measured before/after would size the win.
- **WB-7 compile/memory cost is static-derived.** Per-instance compile time and resident memory under a real N-device session were not benchmarked; the linear-scaling claim is from the instantiation pattern, not a runtime trace.
- **WB-3 firing likelihood** depends on how often the pinned `wasm-bindgen` init-line format changes; not quantified here.
- Whether `daw-wasm-decoder` (no gen script, no src glue, `--no-typescript`) has a consumer that could also drift was not traced to closure — out of the daw-dsp/proof/scoring core scope.

---

## Cross-references
- `AUDIT-offline-export.md` OE-5 (`Array.from(bytes)` IPC inflation) — re-verified live at `writeNativeAudioStemFile.ts:18`, `writeNativeAudioMixdownFile.ts:17`; registered here as WB-5.
- `AUDIT-dsp-engines.md` DSP-8 (no NaN/Inf sanitization at the wasm output boundary) — compounds WB-6 (a NaN-driven panic dies invisibly).
