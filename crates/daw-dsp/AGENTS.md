# daw-dsp crate — Agent Guidelines

Pure mathematical DSP: the bread-named device engines, one module each, every one exposing a
`#[wasm_bindgen]` `*Instance` struct. No I/O, no desktop IPC, no repositories. Dependencies stay
minimal.

Dual compilation target: native (linked via `daw-engine`) and WASM. Code must compile cleanly for
both — gate platform-specific bits behind `cfg(target_arch = "wasm32")` as existing modules do.

Engine module names are snake_case versions of the TS module names (`GrandBoule` ↔ `grand_boule`).
The reverb ("Dutch Oven" / ProofChamber) is not here — it is the sibling `proof-chamber` crate; the
tuner is `scoring`.

`crumbs` has a `CrumbsInstance` like the rest, but its **disk-streaming** mode stays native-only:
`crumbs::streaming` only schedules reads that the integration layer performs, and an
`AudioWorkletGlobalScope` has no file API to perform them with. The wasm binding renders from the
in-memory pool that `add_sample` fills over the worklet port.

## The audio path allocates nothing and locks nothing

`tests/device_process_rt.rs` guards every `#[wasm_bindgen]` process/render export in this crate; the
sibling `proof-chamber` crate guards its own in `tests/reverb_process_rt.rs`.

- **Convolution is the exception, and it is pinned, not fixed.** It builds scratch frames per
  partition boundary, and Hybrid inherits that as soon as its convolution routing is engaged. No
  product surface can select either, so this is carried weight rather than a live fault, recorded
  as a measured fact by `convolution_backed_engines_still_allocate_on_the_render_path` in the
  sibling `proof-chamber` crate's `tests/reverb_process_rt.rs`. Never treat convolution as covered.
- **Drive the engine, then guard it.** Most engines early-return while every stage sits at its
  default, so a guard wrapped around an unconfigured instance passes without executing any DSP.
  Each guard drives its engine into a configured, audibly active state and asserts non-silence. If
  you add a family, drive it.
- **The interceptor is debug-only.** `assert_no_alloc`'s `disable_release` feature is on by
  default, so in a release build `assert_no_alloc(f)` is literally `f()` and every guard here is a
  no-op. Verify in debug or you are proving nothing.
- **A violation aborts; it does not fail.** `std::alloc::handle_alloc_error` aborts the process
  instead of unwinding, so the symptom is `SIGABRT` with `memory allocation of N bytes failed`, not
  a normal test failure. `alloc_interceptor_aborts_the_process_on_a_forbidden_allocation` proves
  the interceptor is installed at all.
- **Guarding `set_param` is not guarding `process`.** A wrapper around `set_param_by_id` is a
  control-rate check and says nothing about the render path. A grep hit for `assert_no_alloc` in a
  module is not evidence that its audio path is covered — read what the call actually wraps.

## Output level at the engine boundary is pinned

`tests/engine_output_level.rs` drives device families' `*Instance` render exports with a fixed
stimulus and asserts peak and RMS inside a two-sided ±1 dB band, plus Grinder's model separation and
that its −0.3 dB output safety limiter stays idle at shipped settings. Coverage is not universal —
`crumbs` has no band here — so read the file before assuming a family's level is pinned. Every other
guard here measures the stage under test, so a change upstream of an engine's output can move
delivered level by several dB and pass everything: a shelf relocation in `grinder/triode.rs` once
moved a model +6.2 dB peak and cleared the whole gate set.

- **Measure at the engine output, after the cabinet and limiter.** The observation point is part of
  the claim. A number taken at `Preamp` says nothing about what anyone hears — models that tie at
  the preamp separate by +32% to +66% after the cabinet, and a shelf relocation that trips a preamp
  test can leave the output unmoved.
- **If a band fails, re-measure, move the expected value in the same commit, and say so.** Never
  widen a band to fit: the width is the claim. The values are measurements, not targets; nothing is
  sacred about them except their being honest.
