---
type: research
id: RESEARCH-grinder-neural-model-loading
title: Grinder neural model loading
status: open
owner: The Sourdaw team
sources:
  - ../grinder-stabilization-phase-1/audit.md
---

# Research: Grinder neural model loading

## Question

What documented external neural-model contract can Grinder ship now — without lying in
the UI or breaking the current browser/WASM audio path — and how should built-in vs
external model loading be sequenced?

## Findings

### R-001 — NAM exposes a documented JSON file format realistic to import

- **Claim:** `.nam` files are JSON with documented top-level fields (versioning, metadata, architecture/config, weights), so Grinder's browser/WASM build can parse and carry them without a native filesystem or ONNX runtime dependency.
- **Evidence:** Neural Amp Modeler docs, "The `.nam` file format", `https://neural-amp-modeler.readthedocs.io/en/latest/file_formats/nam.html`.
- **Confidence:** high
- **Bears on:** targeting `.nam` JSON import as the first external path (phase 8).

### R-002 — Full NAM runtime parity is a much bigger project than "real external loading"

- **Claim:** NeuralAmpModelerCore is a dedicated inference engine, not a convenience parser; matching it would mean embedding the real runtime or implementing much closer execution semantics than Grinder's neural block.
- **Evidence:** NeuralAmpModelerCore README, `https://github.com/sdatkinson/NeuralAmpModelerCore`.
- **Confidence:** high
- **Bears on:** separating "real asset loading/management" from "reference-fidelity inference parity".

### R-003 — AIDA-X is relevant context but a worse first contract than NAM

- **Claim:** AIDA-X supports model-based capture workflows but lacks the lightweight, stable, end-user-oriented file-format documentation NAM provides, and widens scope to a second ecosystem prematurely.
- **Evidence:** AIDA-X README, `https://github.com/AidaDSP/AIDA-X`.
- **Confidence:** medium
- **Bears on:** keeping phase 8 NAM-first and deferring AIDA-X.

### R-004 — The current Grinder engine can transport custom profiles without new IPC

- **Claim:** The browser audio engine already has a `setPatch`/structured MessagePort pattern for other WASM devices, so a structured Grinder patch message can carry imported neural profiles instead of inventing a second control plane.
- **Evidence:** repo inspection of the browser AudioWorklet transport and Grinder's numeric-param-only path.
- **Confidence:** high
- **Bears on:** the parse → derive compact profile → structured patch payload → apply-in-Rust flow (phases 7–8).

### R-005 — Project portability matters more than raw file-path persistence

- **Claim:** Storing only a model id plus a local library reference makes projects sonically wrong when the library is unavailable; a compact derived profile embedded in the patch avoids that even if the reusable library restores lazily.
- **Evidence:** failure-mode analysis of library-only vs patch-embedded selection state.
- **Confidence:** high
- **Bears on:** embedding compact profiles in the patch (phase 8) and library management (phase 14).

## Open questions

- [ ] Q-001 — Should a later phase store the original imported `.nam` payload alongside
  the compact profile for future re-render or export workflows? (answered by phase 14)
- [ ] Q-002 — When AIDA-X support arrives, should it map into the same compact Grinder
  profile type or require a second imported-profile variant?

## Recommendation

Make the built-in library audible first (phase 7), then go NAM-first for external
loading (phase 8): import `.nam` JSON, validate documented structure, derive a compact
Grinder profile, persist entries for modal reuse, embed the selected compact profile in
the patch for portability (R-005), and transport it through the existing structured
worklet message (R-004) — without claiming drop-in NAM runtime parity (R-002).
