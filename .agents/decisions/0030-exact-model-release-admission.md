---
type: adr
id: 0030
title: Exact model artifacts require release admission
status: partially superseded by 0035 (DDSP checkpoints) and 0036 (WebLLM Qwen conversions)
date: 2026-08-17
owner: The Sourdaw team
sources:
    - https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/tree/1939ad2a8e416c0acfeecc08a694d14ef25f2231
    - https://huggingface.co/ggerganov/whisper.cpp/tree/5359861c739e955e79d9a303bcbc70fb988958b1
    - https://crates.io/crates/whisper-rs/0.16.0
    - https://registry.npmjs.org/@spotify/basic-pitch/1.0.1
    - https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC
    - https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC
    - https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC
    - https://github.com/magenta/ddsp
    - .agents/decisions/0016-ultracode-session-scope-and-standard.md
---

# 0030 — Exact model artifacts require release admission

> **Partially superseded by ADR 0035.** The DDSP checkpoint row and its DDSP-specific consequences
> are superseded. The exact-artifact admission rule and every other stack decision remain accepted.

**Accepted 2026-08-17.** This narrows ADR 0016: browser-capable model features still require exact
artifact admission. Browser WebLLM architecture remains, but its quantized artifacts are withheld.

> **Partial supersession — 2026-08-22.** ADR 0036 supersedes this decision only for the three
> pinned WebLLM Qwen conversions and the WebLLM-withholding consequence below. Every other
> admission requirement, stack decision, and consequence remains accepted.

## Context

A framework license does not license every checkpoint, conversion, voice, or quantized repository
used with it. Mutable URLs and inherited claims cannot prove distributed bytes.

## Decision

One release contract records model-stack admission. An unadmitted stack is unreachable and absent
from product controls. Its neutral architecture may remain.

| Stack                   | Decision | Proof                                                                                             |
| ----------------------- | -------- | ------------------------------------------------------------------------------------------------- |
| Basic Pitch 1.0.1       | Admit    | Apache-2.0 package metadata and lockfile integrity cover the bundled model.                       |
| Kokoro ONNX             | Admit    | Commit `1939ad2a`; exact model size and SHA-256; exact size and SHA-256 for each exposed voice.   |
| Whisper                 | Admit    | Pinned `ggml-base.en.bin` size and SHA-256; MIT model repository; Unlicense `whisper-rs` runtime. |
| DDSP checkpoints        | Withhold | Exact GCS checkpoint licenses and immutable digests remain unproved.                              |
| RAVE models             | Withhold | No model artifact, source, digest, or license is admitted.                                        |
| WebLLM Qwen conversions | Withhold | Historical decision; ADR 0036 now admits only the three pinned Qwen conversions under Apache-2.0. |
| Native denoise          | Keep     | The current downward expander is first-party DSP with no external model artifact.                 |
| Stem separation         | Withhold | No replacement model stack is admitted; the current repository reports it unavailable.            |

Kokoro downloads use the pinned revision, a versioned cache key, exact byte counts, and SHA-256
verification before storage or inference. The release contract blocks WebLLM and RAVE before model
loading and keeps DDSP out of the runtime registry and model manager.

## Consequences

- Hosted language models remain desktop-only and explicit.
- The original release had no browser-local language model; ADR 0036 admits the pinned WebLLM Qwen
  conversions.
- Kokoro, Whisper, and Basic Pitch remain available with their notices.
- Native denoise remains available without a model dependency.
- DDSP and RAVE can return only after a later ADR admits exact artifacts and obligations. ADR 0036
  admits the pinned WebLLM Qwen conversions with its stated obligations.
- Stem separation remains unavailable until a complete replacement stack passes admission.
