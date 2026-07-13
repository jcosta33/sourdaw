---
type: bug
id: BUG-microtuning-tuning-table-default-compile
title: daw-core tuning table prevents cargo workspace compilation
status: fixed
owner: The Sourdaw team
sources:
  - .agents/findings/deep-codebase-risk-audit-2026-06-27.md
  - SPEC-microtuning-engine
---

# Bug: daw-core tuning table prevents cargo workspace compilation

## Symptom

`cargo test --workspace` does not reach tests because `daw-core` fails to compile in the tuning-table module.

## Reproduction

1. From `/Users/josecosta/dev/sourdaw`, run `cargo test --workspace`.

**Expected:** The Rust workspace compiles and proceeds to execute tests.
**Actual:** Compilation stops in `daw-core`.
**Conditions:** Reproduced on 2026-06-27 from the local `sourdaw` working tree.

```text
error: non-item in item list
  --> crates/daw-core/src/tuning.rs:12:1
   |
11 | impl Default for TuningTable {
   |                              - item list starts here
12 | ...
   | ^^^ non-item starts here
13 | }
   | - item list ends here

error[E0432]: unresolved import `triple_buffer`
 --> crates/daw-core/src/tuning.rs:3:5
  |
3 | use triple_buffer::Output;
  |     ^^^^^^^^^^^^^ use of unresolved module or unlinked crate `triple_buffer`

error[E0046]: not all trait items implemented, missing: `default`
  --> crates/daw-core/src/tuning.rs:11:1

error: could not compile `daw-core` (lib) due to 3 previous errors; 1 warning emitted
```

## Root cause

`crates/daw-core/src/tuning.rs:11-13` defines `impl Default for TuningTable` with a literal `...` placeholder instead of a `default` function body. The same file imports `triple_buffer::Output` at `crates/daw-core/src/tuning.rs:3`, but `crates/daw-core/Cargo.toml:10-12` only declares `serde` and `specta`, so the dependency is unavailable to `daw-core`.

## Affected requirements

- `SPEC-microtuning-engine#AC-001` — the tuning table cannot be verified with `cargo test -p daw-core tuning_table_size` while `daw-core` does not compile.
- `SPEC-microtuning-engine#AC-002` — triple-buffer delivery cannot be verified while the `triple_buffer` dependency is referenced without being declared.
