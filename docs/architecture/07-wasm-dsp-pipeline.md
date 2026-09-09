# WASM DSP Pipeline

Sourdaw's built-in device DSP is written in Rust and compiled to WebAssembly for the browser. This
document describes the WASM build, codegen, loading path, and its traps.

It complements:

- `Rust Backend Architecture` — crate topology and the native side
- `src/modules/AudioEngine/AGENTS.md` — the engine's operational rules
- `crates/daw-dsp/AGENTS.md` — DSP crate conventions

---

## 1. Build pipeline

```text
crates/daw-dsp, proof-chamber, scoring, daw-wasm-decoder
        │  pnpm wasm:all  (wasm-pack build --target web)
        ▼
public/wasm/<crate>/            wasm-bindgen JS glue + *_bg.wasm
        │  scripts/gen-*-worklet.ts
        ▼
src/modules/AudioEngine/wasm/   worklet-loadable glue (committed)
        │  initSync({ module }) with a precompiled module
        ▼
AudioWorklet processors         services/*Processor.ts, workers/*EngineWorker.ts
```

The `wasm:*` scripts (`package.json`) run `wasm-pack` per crate into `public/wasm/`, then a generator script rewrites the glue for the worklet environment:

- Prepends AudioWorklet-scope polyfills (`TextDecoder`/`TextEncoder`/`FinalizationRegistry` — absent in worklet scope).
- Replaces `new URL('*_bg.wasm', import.meta.url)` with a static path so Vite does not try to bundle the `.wasm` out of `src/`.

Never hand-edit files under `src/modules/AudioEngine/wasm/` — regenerate via the matching `wasm:*` script. `wasm:all` builds all four crates.

### Hosted artifact generation

Publish a Scoring or ProofChamber source change through `pnpm lane:publish` to request a hosted build. The independent **Hosted WASM artifacts** pull-request workflow checks out the exact PR head and selects stale supported packages by the existing crate-closure fingerprint. Changes to the matching generator select its package; changes to shared generation inputs or the hosted workflow/helper select both. Unsupported stale packages fail explicitly. A current head with no generation changes reports no work and uploads nothing.

The isolated Ubuntu job installs the repository's pinned Rust and wasm-pack toolchains, runs the selected package scripts sequentially, regenerates one combined manifest for only successful builds, and runs `wasm:verify`. Generation may change only declared output files and the manifest. Only a successful complete build qualifies an upload; this workflow has no repository-write permission, deployment, or automatic commit path. Existing required validation still rejects a source head whose committed artifacts are stale.

The returned artifact is named `wasm-<source-head>-<run-id>-<attempt>`. It contains each selected package's complete declared output set, `public/wasm/manifest.json`, and `receipt.json`. The receipt records source/workflow/run identity, actual toolchain version output, and file hashes. Outputs are bounded to 10 MiB and expire after one day. A receipt or source fingerprint alone does not prove honest generation: review the workflow and helper at their recorded revision and inspect successful package-build logs.

Download and verify the return before copying files into an author lane:

1. Identify the successful **Hosted WASM artifacts** run and its exact artifact ID. Fetch the run and artifact metadata from GitHub's official REST endpoints, using read-only access: `gh api repos/OWNER/REPO/actions/runs/RUN_ID > run.json`, `gh api repos/OWNER/REPO/actions/artifacts/ARTIFACT_ID > artifact.json`, and `gh api repos/OWNER/REPO/actions/artifacts/ARTIFACT_ID/zip > artifact.zip`. Keep these downloads in private artifact storage. Verify the repository, PR, source head, run attempt, workflow path, and successful build logs before trusting the metadata. The helper treats supplied metadata as caller-trusted API evidence; arbitrary JSON is not proof of GitHub origin.
2. From the source lane, whose HEAD must still match the built head and whose tracked and untracked source must be clean, run `pnpm wasm:hosted verify-return /absolute/artifact.zip /absolute/run.json /absolute/artifact.json OWNER/REPO PR_NUMBER RUN_ID ARTIFACT_ID /absolute/private/verified-output`. The final directory must not exist and must be outside the source checkout. This checks the archive digest against API metadata, run/head/attempt identity, ZIP structure and size limits, canonical regular-file members, complete package membership, and receipt hashes before publishing any verified files. It neither executes downloaded scripts nor changes the source lane.
3. Copy only the files named in the verified receipt's `files` mapping from that private directory into the same clean source-head lane, preserving their relative paths. Do not copy `receipt.json`, helper programs, or automatic commits. Run `pnpm wasm:verify`, inspect the resulting diff, stage those exact generated paths, and run `pnpm wasm:verify` after staging. Commit them and publish through the protected primary checkout's `pnpm lane:publish` route. A changed source head requires a new hosted build; do not reuse the old receipt.

The workflow can be introduced and exercised on its own mergeable pull request through normal publication. Its first successful build/upload and verified download are required acceptance evidence before relying on it. Infrastructure bootstrap output remains private evidence rather than an unrelated artifact restamp commit.

## 2. Loading at runtime

Worklets cannot fetch asynchronously at construction time, so the main thread fetches and
asynchronously compiles each URL once through `fetchWasmModule`. Public WASM assets have stable
filenames, so the first request revalidates the HTTP cache (`cache: 'no-cache'`) to prevent fresh
generated glue from loading a stale binary; the in-memory promise still performs only one request
and compilation per runtime URL. Each acquisition holds a short-lived version lease: aborting the
request or failing host construction releases it, while a successful handoff to an
`AudioWorkletNode` or Worker commits one URL for each generated-glue bundle (`daw-dsp`,
`proof-chamber`, `scoring`) to the `AudioContext`.

wasm-bindgen initialization is a realm singleton, so attempting to mix bundle versions fails
explicitly and a version change requires a fresh context. Each admitted `AudioWorkletNode` supplies
the resulting structured-cloneable `WebAssembly.Module` in `processorOptions`; processors call
`initSync({ module: wasmModule })` without synchronous compilation on their real-time-adjacent
threads. Sourdaw targets current Chrome, where compiled modules cross these same-agent-cluster
boundaries. The shared handshake lives in `src/infra/audioWorklet/workletInitShared.ts`.

`daw-dsp` exports every release-admitted instance in its `wasm32` crate graph, including Grand
Boule. Grand Boule's live engine runs in a Worker behind a SharedArrayBuffer ring; its worklet pays
only the ring-consumer cost. Offline render runs the engine inline because an
`OfflineAudioContext` has no live deadline.

Release validation treats `scripts/wasm-artifacts.ts` as the package and path authority. It rejects
unexpected manifest packages, crate roots, artifact paths, and recursively discovered sidecars
across the complete `public/wasm` tree and every declared AudioEngine mirror. `manifest.json` is the
only public non-artifact control file. Every declared text artifact is scanned and every declared
`.wasm` export table is inspected before a release inventory can pass.

## 3. What runs where

| Crate                  | WASM | Native | Notes                                                                                            |
| ---------------------- | ---- | ------ | ------------------------------------------------------------------------------------------------ |
| daw-dsp                | ✓    | ✓      | Grand Boule uses Worker/live and inline/offline hosts; Crumbs WASM uses an in-memory sample pool |
| proof-chamber (reverb) | ✓    | —      | WASM-only crate; "Dutch Oven" device id                                                          |
| scoring (tuner)        | ✓    | —      | WASM-only crate; passthrough audio + telemetry                                                   |
| daw-wasm-decoder       | ✓    | —      | main-thread decode for codecs `decodeAudioData` can't handle (ALAC, m4a, FLAC/OGG edge cases)    |

`daw-wasm-decoder` has no worklet generator — it is used on the main thread where async fetch is fine.

## 4. Traps

- **Worklet isolation.** Worklet code may not import app/helpers/desktop IPC (`worklets-no-*` depcruise rules — currently forward-looking: they match `src/modules/<M>/worklets/**` only; the 3 raw JS processors in `public/audio/worklets/` sit outside those paths).
- **`worker.format: 'iife'`** in `vite.config.ts` exists so worklet blob URLs can load bundles. Changing it breaks worklet loading in non-obvious ways.
- **Two Faust integration points** — AudioEngine and PluginHost both use `@grame/faustwasm` (`public/faust/`). Check both before touching Faust wiring.
- **Allocation.** The Rust side of this pipeline is held to an alloc-free audio path, test-proven via `assert_no_alloc` in daw-dsp. The WASM target is not an exemption.

## References

- `src/modules/AudioEngine/AGENTS.md` — operational rules and node wiring
- `crates/daw-dsp/AGENTS.md` — engine authoring rules
- `.agents/skills/web-audio-engine/SKILL.md` — RT safety and graph discipline
