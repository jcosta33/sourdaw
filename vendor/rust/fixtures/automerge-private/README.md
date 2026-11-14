# Actual-source private invariants

This standalone manifest's lib path compiles the genuine modified Automerge source with cfg(test).
It exposes no public testing API and copies no implementation. Run these exact bounded subjects
through the repository guard with the pinned toolchain, two Cargo jobs and two test threads:

```
cargo test --locked --manifest-path vendor/rust/fixtures/automerge-private/Cargo.toml --lib root_port_ -- --nocapture --test-threads=2
cargo test --locked --manifest-path vendor/rust/fixtures/automerge-private/Cargo.toml --test dev_consumer -- --test-threads=2
cargo test --locked --manifest-path vendor/rust/fixtures/automerge-private/Cargo.toml --lib op_set2::op_set::op_iter::tests -- --skip root_port_ --test-threads=2
```

The owner-module witnesses exceed the actual stable leaf capacity and check every mark/metadata
prefix through split, delete, reweight, remap and undo. Large metadata weights represent bytes
without allocating their payloads. Sparse counter probes count visited slabs and retain native run
matching inside a compressed repeated run. Independent vectors and sets are test oracles, never
production storage or indexes. The original paired iterator cases preserve null/root/absent-object
seek positions and successor/skip alignment.

The separate dev consumer observes actual terminal/table output and executes a logging macro's test
body. Its negative modifier case supplies the typed Syn function state the transformer receives;
free-function tokens already rejected during parsing do not prove that later validator.

The inclusive-maximum and sparse signed/null/zero/maximum counter witnesses also admit exact
wasm32-wasip1 execution. The full upstream suite is not a local fallback, and these subjects do not
establish production JS WASM, application Undo/collaboration, platform runtime or sound behavior.
