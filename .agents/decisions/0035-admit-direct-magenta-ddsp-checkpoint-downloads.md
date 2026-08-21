---
type: adr
id: 0035
title: Admit direct Magenta DDSP checkpoint downloads
status: accepted
date: 2026-08-21
owner: The Sourdaw team
supersedes: 0030 (DDSP checkpoints only)
sources:
    - https://raw.githubusercontent.com/magenta/magenta-js/0692eb2b79681f062c6b6dd53a0361967f298caa/music/checkpoints/README.md
    - https://raw.githubusercontent.com/magenta/magenta-js/0692eb2b79681f062c6b6dd53a0361967f298caa/music/src/ddsp/model.ts
    - src/modules/BrowserAi/models/DdspArtifactManifest.ts
    - src/modules/BrowserAi/useCases/downloadDdspInstrument.ts
    - release/open-source-inventory.json
    - public/legal/THIRD-PARTY-NOTICES.md
    - https://github.com/jcosta33/sourdaw/issues/2595
---

# 0035 — Admit direct Magenta DDSP checkpoint downloads

**Accepted 2026-08-21.** This partially supersedes ADR 0030 for the DDSP checkpoint row only. ADR
0030's exact-artifact admission rule and every other model-stack decision remain accepted.

## Context

ADR 0030 withheld DDSP while its mutable checkpoint URLs lacked immutable artifact identities. The
repository now pins all twelve artifacts for the four admitted instruments in
`DdspArtifactManifest`: each exact URL, byte size, and SHA-256 digest is part of the release contract.

Magenta.js's immutable checkpoint README documents loading these DDSP checkpoints directly from the
Magenta server. Its immutable DDSP model source documents the checkpoint file shape used by that
runtime. Neither source grants a license for the checkpoint weights.

## Decision

- Sourdaw admits the exact twelve artifacts pinned by `DdspArtifactManifest`, not a mutable
  checkpoint directory or caller-supplied URL.
- Admitted `DdspArtifactManifest` SHA-256:
  `6f39f28c5ad181ce246a368bb4764d5faf5c48c433150482b4429832eb3424ec`. A changed manifest requires
  a later admission decision; editing this accepted decision is not an update mechanism.
- The user's browser fetches those bytes directly from Magenta only after an explicit instrument
  download action. The download repository stages the response and verifies the declared byte size
  and SHA-256 before publishing a generation for readiness or use.
- The checkpoint license remains unverified. Apache-2.0 and MIT runtime licenses and notices cover
  their named code and libraries only; they do not cover or grant rights to the checkpoint weights.
- Sourdaw does not bundle or redistribute the checkpoint bytes. Self-hosting or mirroring remains
  deferred to issue #2595.
- If any part of this admission contract stops holding, reversal is setting
  `MODEL_RELEASE_ADMISSION.ddsp` to `false`.

## Consequences

- Browser and desktop users can explicitly download the four pinned DDSP instruments from Magenta.
- Readiness is still fail-closed: only a fully verified, published local generation is usable.
- The public legal notice and release inventory must keep the unverified checkpoint license and
  no-bundling boundary explicit.
- A host migration, added instrument, or changed artifact requires new exact identities and a new
  admission decision; it cannot inherit this one.
