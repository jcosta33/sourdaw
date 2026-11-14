# Native stable Automerge consumer

This standalone consumer protects Automerge's published change/document/bundle encoding while using
the genuine stable Hexane backend. Run through the repository guard, the pinned toolchain, two Cargo
jobs and at most two test threads:

```
cargo test --locked --manifest-path vendor/rust/fixtures/automerge-stable/Cargo.toml --tests -- --test-threads=2
```

The immutable goldens came from pristine Automerge 0.12.0 with Hexane 1.0.0-alpha.5. Their original
archive, lock and byte identities are in `goldens/origin-identities.json`. Never regenerate them from
the modified implementation or relax their exact byte comparisons. Opposite merge orders have
separate original physical-save goldens; logical convergence does not require their save bytes to
match each other.

The subjects cover independent LEB/RLE bytes, bounds and malformed inputs, signed timestamp extrema,
absolute delta predicates/seeks, marks, remapping, rollback, concurrent merges and original change
hashes. Large multi-node witnesses belong to the actual-source private fixture.

`host32` checks maximum-counter pristine save/load/get_changes/bundle/seek behavior and a real empty
commit after maximum. Bundle admission follows the actual host width; the same maximum document and
empty change must preserve bytes on both widths. `pristine-max-origin.json` binds the independent
maximum document. `run-wasi.mjs` executes an exact libtest filter on real wasm32-wasip1 output using
Node's builtin WASI Preview1, with no preopens or simulated pointer width.

These fixtures do not establish production JS WASM, Sourdaw project/archive/action Undo or
collaboration integration, platform runtime behavior, audio hardware or sound preservation.
