---
type: bug
id: BUG-daw-engine-scheduler-stub-compile
title: daw-engine scheduler contains compile-blocking stub code
status: fixed
owner: The Sourdaw team
sources:
  - "Transient finding: remaining-surface-audit-2026-06-27"
  - SPEC-plugin-hosting-clap
---

# Bug: daw-engine scheduler contains compile-blocking stub code

## Symptom

`crates/daw-engine/src/scheduler.rs` is part of the native plugin/audio scheduling path, but the file contains invalid Rust and an undeclared dependency import. Once the existing `daw-core` compile blocker is fixed, this crate will still fail before plugin-hosting verification can run.

## Reproduction

Inspect the scheduler source:

```text
/Users/josecosta/dev/sourdaw/crates/daw-engine/src/scheduler.rs:12:use triple_buffer::Output;
/Users/josecosta/dev/sourdaw/crates/daw-engine/src/scheduler.rs:118:                GraphCommand::AddPlugin(id, plugin) => {
/Users/josecosta/dev/sourdaw/crates/daw-engine/src/scheduler.rs:126:                GraphCommand::SetPluginParam(id, param_id, value) => {
/Users/josecosta/dev/sourdaw/crates/daw-engine/src/scheduler.rs:160:                ...
/Users/josecosta/dev/sourdaw/crates/daw-engine/src/scheduler.rs:211:                            num_samples,
/Users/josecosta/dev/sourdaw/crates/daw-engine/Cargo.toml:10:daw-core = { path = "../daw-core" }
```

**Expected:** `daw-engine` compiles after earlier workspace blockers are removed.
**Actual:** the scheduler has an unterminated `AddPlugin` match arm, raw `...` text, a `num_samples` reference before the closure binds it, and `triple_buffer` is imported/used without being declared in `crates/daw-engine/Cargo.toml`.
**Conditions:** Source inspection on 2026-06-27. A direct `cargo check -p daw-engine --lib` currently exits earlier in `daw-core`, so this bug is queued behind `BUG-microtuning-tuning-table-default-compile`.

## Root cause

Native scheduler work was left in a partially stubbed state while the plugin-hosting path was being introduced. The crate manifest was not updated for the scheduler's `triple_buffer` dependency.

## Affected requirements

- `SPEC-plugin-hosting-clap#AC-003` - native plugin audio transport cannot be validated while the scheduler crate cannot compile.
- `SPEC-plugin-hosting-clap#AC-011` - bridge queue sizing cannot be tested through the native scheduler.
- `SPEC-plugin-hosting-clap#AC-012` - underrun/drop behavior cannot be tested through the native scheduler.
