---
type: adr
id: 0035
title: Admit pinned WebLLM Qwen conversions under Apache-2.0
status: accepted
date: 2026-08-22
owner: The Sourdaw team
supersedes:
    - .agents/decisions/0030-exact-model-release-admission.md (WebLLM Qwen withholding only)
sources:
    - https://huggingface.co/mlc-ai/Qwen3-1.7B-q4f16_1-MLC/tree/80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc
    - https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC/tree/a5c9fab855e3ccbdfed2e7e69683d75f30332161
    - https://huggingface.co/mlc-ai/Qwen3-8B-q4f16_1-MLC/tree/b3d55c289eae58f77095f5b68c895eeea358ee09
    - https://huggingface.co/Qwen/Qwen3-1.7B/blob/main/LICENSE
    - https://huggingface.co/Qwen/Qwen3-4B/blob/main/LICENSE
    - https://huggingface.co/Qwen/Qwen3-8B/blob/main/LICENSE
    - https://www.apache.org/licenses/LICENSE-2.0
    - https://github.com/mlc-ai/web-llm/blob/main/LICENSE
    - src/modules/AiRuntime/repositories/webLlm/webLlmArtifactManifest.generated.json
    - src/modules/AiRuntime/repositories/webLlm/webLlmArtifactAdmission.ts
    - public/legal/Qwen-NOTICE.txt
---

# 0035 - Admit pinned WebLLM Qwen conversions under Apache-2.0

## Context

ADR 0030 correctly required evidence for each distributed model artifact and withheld the WebLLM
stack because the exact MLC conversion repositories had no repository-level `LICENSE` metadata.
The three cards identify the official Qwen 1.7B, 4B, and 8B models that they convert to MLC format.
Those Qwen models publish Apache-2.0 licenses. Apache-2.0 defines object form to include mechanical
transformation or conversion, and grants reproduction, derivative works, and distribution in source
or object form.

The MLC repository metadata omission remains an imperfect provenance record. It is not evidence that
the upstream Apache grant for the identified Qwen work disappeared. The MLC/WebLLM runtime is also
Apache-2.0. The release manifest already pins the exact conversion revisions and verifies every
downloaded artifact's byte count and SHA-256 before caching or inference.

## Decision

Admit only these exact WebLLM Qwen MLC conversions:

| Qwen model | MLC conversion revision                    | Artifact-set digest                                                |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Qwen3 1.7B | `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc` | `932ad158daa0d6814a50c5fb6aa85f88c3d3892a58a0dc20d47ff0b9e6e0b255` |
| Qwen3 4B   | `a5c9fab855e3ccbdfed2e7e69683d75f30332161` | `2438f2a6b58372e12ca0aa949443a49ca7b6060ad3e7971aed0d56b49a35195f` |
| Qwen3 8B   | `b3d55c289eae58f77095f5b68c895eeea358ee09` | `7e7da9410d3b7cdeea46c0c2f417e560e54a2c736e8474e04b85e466e41022bb` |

`MODEL_RELEASE_ADMISSION.webLlm` admits these artifacts on both browser and Electron targets. An
explicit WebLLM selection remains exclusive: absent WebGPU it is unavailable and never falls back to
a hosted provider. Automatic mode also fails closed when WebLLM is unavailable; hosted providers
require an explicit selection.

Every web and desktop release carries the Apache-2.0 text and Qwen attribution in
`public/legal/Apache-2.0.txt` and `public/legal/Qwen-NOTICE.txt`. The release must preserve the
pinned revisions, generated manifest, artifact-set digests, and byte/hash verification. The missing
conversion-repository license metadata remains recorded as residual evidence, not an admission
blocker.

This partially supersedes ADR 0030 only for the WebLLM Qwen conversion withholding decision. ADR
0030's exact-artifact principle and every decision for other model stacks remain unchanged.

## Consequences

- Browser and Electron users can select WebLLM on any platform; runtime capability still requires
  WebGPU.
- WebLLM downloads only the admitted manifest artifacts and verifies them before use.
- No native inference path or hosted fallback is introduced.
- Any new model family, conversion, revision, digest, or conflicting provenance evidence requires
  separate admission evidence; this decision does not lower that requirement.
