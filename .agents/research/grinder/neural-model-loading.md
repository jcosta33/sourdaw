# Grinder Neural Model Loading Research

## Purpose

Ground the next Grinder Neural phase around a real external model-loading path. The immediate question is not "can Grinder become a full NAM/AIDA-X runtime today?" but "what documented external model contract can we ship now without lying in the UI or breaking the current browser/WASM audio path?"

## Sources

1. Neural Amp Modeler documentation, "The `.nam` file format".
   Source: official Neural Amp Modeler docs.
   URL: `https://neural-amp-modeler.readthedocs.io/en/latest/file_formats/nam.html`

2. NeuralAmpModelerCore README.
   Source: official NeuralAmpModelerCore repository.
   URL: `https://github.com/sdatkinson/NeuralAmpModelerCore`

3. AIDA-X README.
   Source: official AIDA-X repository.
   URL: `https://github.com/AidaDSP/AIDA-X`

## Findings

### 1. NAM exposes a documented, JSON-based file format that is realistic to import in this phase

The NAM documentation describes `.nam` files as JSON and documents major top-level fields such as versioning, metadata, architecture/config, and weights. That matters because Grinder's current browser/WASM implementation can already parse JSON and carry compact structured payloads without introducing a native filesystem or ONNX runtime dependency into this phase.

Implication for Grinder:

- A bounded external-capture phase can target `.nam` JSON import first.
- The import path can validate documented structural fields rather than guessing an opaque binary format.

### 2. Full NAM runtime parity is a much bigger project than "real external loading"

NeuralAmpModelerCore is a dedicated runtime focused on authentic model execution. It is not a tiny convenience parser; it is the inference engine. Matching that runtime inside Grinder would require either embedding the real runtime or implementing materially closer model execution semantics than the current placeholder neural block provides.

Implication for Grinder:

- This phase should separate "real model asset loading and management" from "full NAM reference-fidelity inference parity."
- Import should create an audibly real custom profile from the external asset, but the spec should not claim spectral/null-test equivalence to official NAM runtimes yet.

### 3. AIDA-X is relevant product context, but it is a worse phase-8 contract than NAM

The AIDA-X README makes it clear that the project supports model-based amp capture workflows, but it does not present the same lightweight, stable, end-user-oriented file-format documentation path that NAM does. It also widens the phase immediately into another ecosystem before Grinder even has one documented external model contract shipping end-to-end.

Implication for Grinder:

- Phase 8 should be NAM-first rather than "support every capture ecosystem at once."
- AIDA-X should remain a later extension once Grinder has a proven external-model transport and management path.

### 4. The current Grinder engine can already support custom-profile transport without a new IPC architecture

Repo inspection shows the browser audio engine already has a `setPatch` / structured MessagePort pattern for other WASM devices, while Grinder currently only uses numeric param updates. That means the next phase can add a structured Grinder patch message for imported neural profiles instead of inventing a second control plane.

Implication for Grinder:

- External Neural loading can stay inside the existing browser AudioWorklet architecture.
- The right bounded change is: parse file -> derive compact Grinder neural profile -> send structured patch payload -> apply custom profile in Rust.

### 5. Project portability matters more than raw file-path persistence

If Grinder stores only "selected imported model id" plus a local user library reference, projects become sonically wrong whenever that library is unavailable. A compact derived profile embedded in the patch avoids that failure mode even if the reusable browser library is restored lazily.

Implication for Grinder:

- Imported selections should write a compact neural profile into the patch, not just a model id.
- A reusable imported-model library is still useful for the Neural modal, but it should not be the sole owner of audible truth.

## Tradeoffs / comparison

### Option A: wait for full NAM runtime parity

Pros:

- Stronger fidelity story.
- Fewer compromises in model execution.

Cons:

- Much larger DSP and integration project.
- Delays the Neural modal from becoming a real model-management surface.
- Bundles file-format import, runtime parity, and library UX into one large risk area.

### Option B: import documented NAM JSON now, derive a compact Grinder custom profile, and transport it end-to-end

Pros:

- Ships a real external-model loading and management path now.
- Fits the current browser/WASM transport architecture.
- Keeps project portability by embedding derived profile data in the patch.

Cons:

- Imported result is a Grinder-executed custom profile, not full official NAM parity.
- Requires careful UI wording so the feature is honest about what it is loading.

### Option C: support NAM and AIDA-X together immediately

Pros:

- Broader model ecosystem coverage.

Cons:

- Expands scope before one path is proven.
- AIDA-X import contract is less well-bounded from public docs.
- Higher validation and support surface for the same phase.

## Recommendation

Phase 8 should be NAM-first:

- import `.nam` JSON captures through the Neural modal
- validate documented structure
- derive a compact Grinder neural profile
- persist imported entries for reuse in the modal
- embed the selected compact profile in the Grinder patch so the project stays sonically portable
- send imported profiles through a structured Grinder worklet patch message into Rust

This delivers a real external model-loading path without pretending Grinder is already a drop-in NAM runtime.

## Open questions

- Should a later phase store the original imported `.nam` payload alongside the compact Grinder profile for future re-render or export workflows?
- When AIDA-X support arrives, should it map into the same compact Grinder profile type or require a second imported-profile variant?
