---
type: adr
id: 0059
title: Type Rust errors at every module boundary
status: accepted
date: 2026-11-14
owner: The Sourdaw team
sources:
    - crates/sourdaw-native/src/addon/mod.rs
    - crates/sourdaw-native/src/host/plugin_scan_worker.rs
    - crates/sourdaw-native/src/commands/plugins.rs
    - crates/daw-core/src/tuning/scala.rs
    - crates/daw-dsp/src/primitives/time_stretch/contract.rs
    - src/modules/AudioEngine/useCases/livePlayback/engineNotRenderingRefusal.ts
    - src/modules/SampleLibrary/repositories/libraryPersistence/restoreLibrary.ts
---

# 0059 - Type Rust errors at every module boundary

## Context

About 590 lines under `crates/` return `Result<_, String>`. Measured at `origin/main` 928fc3ebfb by
`ast-grep` over non-test function bodies: `sourdaw-native` 357, `daw-plugin-host` 82, `daw-engine`
71, `daw-dsp` 35, `daw-collab` 28, `daw-io` 12, `daw-core` 1.

In `sourdaw-native` the napi surface (`src/addon/mod.rs`) converts every command error with one
helper, `reason()`, which is `map_err(Error::from_reason)`. The JavaScript side therefore receives
message text and nothing else, and no Rust caller inspects most of these errors.

The few places where a failure kind changes behaviour all match message text:

- Rust's plugin-scan classification. `is_process_failure` and `is_response_limit_refusal` in
  `host/plugin_scan_worker.rs` decide crash quarantine with `starts_with` on prefixes the same file
  generates.
- TypeScript matching native message text: `engine-not-rendering:`
  (`engineNotRenderingRefusal.ts`), `automation-queue-capacity` and `device-param-queue-capacity`
  (`pumpNativeLiveAutomationWriter.ts`), `mapping session unknown` and
  `previously applied commands no longer map` (`createNativeOfflineGraphBackend.ts`), the Crumbs
  `already exists` (`syncCrumbsNativeInstances.ts`), and the filesystem texts in
  `restoreLibrary.ts`.

No `String` error is built on a real-time callback today: the `daw-engine` callback and the plugin
process paths already use typed or `Copy` refusals. The house pattern for typed errors is a
hand-written `Display` and `std::error::Error` impl (`TuningParseError` in `daw-core`,
`TimeStretchError` in `daw-dsp`). No crate depends on `thiserror` directly.

An earlier position kept every error no caller classifies as `String`. That position is reversed:
a caller that later needs to tell two failures apart finds only text, and is pushed back into the
prefix matching this decision removes.

## Decision

1. **The enum carries the message and the kind.** Its `Display` prints the text the `String` carried,
   byte-identically, because TypeScript receives that text through the IPC message. A caller, Rust
   or TypeScript, classifies a failure by matching a variant or calling a method on the enum, never
   by a prefix match on text.
2. **No signature below the edge returns `Result<_, String>`.** Each module boundary exposes one
   typed enum, so a caller that later needs to tell two failures apart matches a variant rather
   than discovering that only text exists. A `napi` command body, or a wasm-bindgen export building
   its `JsError`, converts the typed error with `to_string()` there, and those are the only places
   `String` is built from it.
3. **Errors are hand-written enums with `Display` and `std::error::Error`; no `thiserror`.** It
   would add a direct proc-macro dependency to crates in wasm closures and change nothing a caller
   can observe.
4. **`String` remains the wire form at the napi and wasm-bindgen edges.** Making TypeScript match a
   structured code instead of text is a separate IPC contract change and is out of scope here.
5. **Real-time paths never build an owned error.** A variant constructed on a callback carries no
   heap data.
6. **Rollout.** The first slices typed the errors TypeScript matches: plugin-scan classification,
   the graph and Crumbs families, and the sample-library filesystem refusals. #6784 then converts
   the library crates one wave at a time, starting with `daw-core` and `daw-io`, and ends with the
   `sourdaw-native` command families. `clippy::result_unit_err` and `clippy::result_large_err` stay
   under #6525.

## Consequences

- Rewording a message whose text TypeScript matches still needs the PG-001 grep of `src/` and
  `electron/`. A typed enum makes the Rust side of that contract compile-checked: a new failure
  kind is a new variant, and every `match` over it must say what it means.
- A message that two failure kinds share is no longer a classification hazard, because no caller
  reads the text to decide.
- A wave that touches a crate in a wasm package's closure rebuilds that package, because any source
  edit there moves its manifest hash; hand-written impls keep that the only cost.
