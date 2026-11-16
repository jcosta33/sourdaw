---
type: adr
id: 0059
title: Type Rust errors where a caller distinguishes them
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

# 0059 - Type Rust errors where a caller distinguishes them

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

## Decision

1. **A function returns a typed error enum when any caller distinguishes failure kinds.** The caller
   may be Rust, or TypeScript through the IPC message. The enum's `Display` carries today's text
   byte-identically, and classification is a method on the enum, never a prefix match.
2. **A failure that only propagates to the napi edge or to a log stays `String`.** Converting such
   leaf command bodies wholesale is rejected: it adds an enum per command with no caller that
   matches it, churns hundreds of signatures, and moves wasm manifests for no behaviour.
3. **Errors are hand-written enums with `Display` and `std::error::Error`; no `thiserror`.** It
   would add a direct proc-macro dependency to crates in wasm closures and change nothing a caller
   can observe.
4. **`String` remains the wire form at the napi and wasm-bindgen edges.** Making TypeScript match a
   structured code instead of text is a separate IPC contract change and is out of scope here.
5. **Real-time paths never build an owned error.** A variant constructed on a callback carries no
   heap data.
6. **Rollout.** Slice 1 types the plugin-scan classification. Later slices type the graph and Crumbs
   families TypeScript matches, then the remaining library-crate boundaries a caller matches.
   `clippy::result_unit_err` and `clippy::result_large_err` stay under #6525.

## Consequences

- Rewording a message whose text TypeScript matches still needs the PG-001 grep of `src/` and
  `electron/`. A typed enum makes the Rust side of that contract compile-checked: a new failure
  kind is a new variant, and every `match` over it must say what it means.
- A message that two failure kinds share is no longer a classification hazard, because no caller
  reads the text to decide.
- Most `Result<_, String>` signatures stay as they are, deliberately. The count is a measure of
  where the work could go, not of work owed.
