---
type: adr
id: 0037
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
    - https://huggingface.co/Qwen/Qwen3-1.7B/blob/70d244cc86ccca08cf5af4e1e306ecf908b1ad5e/LICENSE
    - https://huggingface.co/Qwen/Qwen3-4B/blob/1cfa9a7208912126459214e8b04321603b3df60c/LICENSE
    - https://huggingface.co/Qwen/Qwen3-8B/blob/b968826d9c46dd6066d109eabc6255188de91218/LICENSE
    - https://github.com/mlc-ai/binary-mlc-llm-libs/pull/168
    - https://github.com/mlc-ai/binary-mlc-llm-libs/tree/146ed9cd4b4062e967b017fd2291f7106b50599f/web-llm-models/v0_2_87/base
    - https://github.com/mlc-ai/mlc-llm/tree/44fd06d04f22c87820e205b0f2b2e5e6a1f6ca85
    - https://github.com/apache/tvm/tree/e345029cedf0be76a087fcad9c89a97bed4f7204
    - https://raw.githubusercontent.com/apache/tvm-ffi/6628c464e3b824d09c9cf65ac0c6c24f973f6d56/LICENSE
    - https://raw.githubusercontent.com/apache/tvm-ffi/6628c464e3b824d09c9cf65ac0c6c24f973f6d56/NOTICE
    - https://github.com/apache/tvm-tirx/tree/198a04573ea44e060c1087c8223cf082c64a6c03
    - https://raw.githubusercontent.com/apache/tvm-tirx/198a04573ea44e060c1087c8223cf082c64a6c03/LICENSE
    - https://raw.githubusercontent.com/apache/tvm-tirx/198a04573ea44e060c1087c8223cf082c64a6c03/NOTICE
    - https://github.com/mlc-ai/web-llm/blob/9e572d6ed95e248f29634996cd32cc8f3023d89d/LICENSE
    - src/modules/AiRuntime/repositories/webLlm/webLlmArtifactManifest.generated.json
    - src/modules/AiRuntime/repositories/webLlm/webLlmArtifactAdmission.ts
    - public/legal/Qwen-NOTICE.txt
---

# 0037 - Admit pinned WebLLM Qwen conversions under Apache-2.0

## Context

ADR 0030 correctly required evidence for each distributed model artifact and withheld the WebLLM
stack because the exact MLC conversion repositories had no repository-level `LICENSE` metadata.
The three cards attribute their conversions to Qwen 1.7B, 4B, and 8B models. Immutable candidate
revisions for those Qwen model families publish Apache-2.0 licenses. That attribution and those
licensed candidates support the accepted admission decision, but do not establish which exact
checkpoint revision each conversion used.

The MLC conversion repositories do not map the converted artifacts to exact base-checkpoint
revisions. Immutable Qwen revisions establish licensed candidates, but not the conversions' exact
Qwen source/license chain or build inputs. The MLC/WebLLM runtime is Apache-2.0.

The admitted WebGPU modules are byte-identical to files in binary-mlc-llm-libs merge
`146ed9cd4b4062e967b017fd2291f7106b50599f`. Its merged PR 168 attests MLC-LLM
`44fd06d04f22c87820e205b0f2b2e5e6a1f6ca85` and Apache TVM
`e345029cedf0be76a087fcad9c89a97bed4f7204` as source revisions. That TVM revision pins
tvm-tirx `198a04573ea44e060c1087c8223cf082c64a6c03`, which in turn pins
tvm-ffi `6628c464e3b824d09c9cf65ac0c6c24f973f6d56`. Sourdaw ships MLC-LLM's exact notice, TVM's
exact root license and notice, tvm-tirx's and tvm-ffi's exact root licenses and notices, and every
file in the referenced license/notice trees. PR 168 does not record an exact emsdk revision,
resolved build configuration, or build log. The release manifest pins the exact conversion
revisions and verifies every downloaded artifact's byte count and SHA-256 before caching or
inference, but the upstream record does not support a claim of exact Qwen checkpoint provenance,
hermetic reproduction, or complete build-input provenance. The dependency update in PR #6470
re-pinned this set (libraries, sources and artifact-set digests) under the same licence decision.

## Decision

Admit only these exact WebLLM Qwen MLC conversions:

| Qwen model | MLC conversion revision                    | Artifact-set digest                                                |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Qwen3 1.7B | `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc` | `a8c02294f8d3c23e7ff2a9174d3a575e7809c7463870b6e23d2d6e6f1dac7991` |
| Qwen3 4B   | `a5c9fab855e3ccbdfed2e7e69683d75f30332161` | `2e136079f88bb3aea4289642db64fef8d77a0cb4c503ca6ca90a4030e0b75756` |
| Qwen3 8B   | `b3d55c289eae58f77095f5b68c895eeea358ee09` | `5121d9a5818d4693e0b0f2dc55f2982ece120b875c955203e4650a9269ad6d2a` |

The corresponding immutable licensed Qwen candidate revisions are
`70d244cc86ccca08cf5af4e1e306ecf908b1ad5e` (1.7B),
`1cfa9a7208912126459214e8b04321603b3df60c` (4B), and
`b968826d9c46dd6066d109eabc6255188de91218` (8B). Together with the conversion cards' attribution,
they support the accepted admission decision; they do not prove that the upstream conversions used
those exact checkpoints or establish an exact Qwen source/license chain.

The admitted WebGPU modules remain exactly:

| Model      | Binary path                                                       |     Bytes | SHA-256                                                            |
| ---------- | ----------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| Qwen3 1.7B | `web-llm-models/v0_2_87/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm` | 6,589,747 | `363f4dbb789f0518e52295d1f4685d2d61feae4ac4e2a6a95621e4af29450bd7` |
| Qwen3 4B   | `web-llm-models/v0_2_87/base/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm`   | 6,874,869 | `2afc399ed01d8ae641beac0528567c8ce22e8c9c7203ba0827c44e13c62be99c` |
| Qwen3 8B   | `web-llm-models/v0_2_87/base/Qwen3-8B-q4f16_1_cs1k-webgpu.wasm`   | 6,875,765 | `3a8d51dc4315f056b6cffc1b8828b1a5e13d29fe096da3bf19096ac637985b81` |

The tvm-ffi root legal files pinned by that chain remain exactly:

| File      | SHA-256                                                            |
| --------- | ------------------------------------------------------------------ |
| `NOTICE`  | `5181189219b74687e08884d813b8f98c874d0e4ba84eb7afc4bb350d22502c24` |
| `LICENSE` | `bb354d8b94589ad8817f2dff029d39a1133d217407f73679d0b0311c980e511f` |

`MODEL_RELEASE_ADMISSION.webLlm` admits these artifacts on both browser and Electron targets. An
explicit WebLLM selection remains exclusive: absent WebGPU it is unavailable and never falls back to
a hosted provider. Automatic mode also fails closed when WebLLM is unavailable; hosted providers
require an explicit selection.

Every web and desktop release carries the Apache-2.0 text and Qwen attribution, MLC-LLM's
exact-revision notice, TVM's exact root license and notice, and the exact tvm-ffi root and referenced
license/notice trees under `public/legal/`. The release must preserve the pinned revisions, generated
manifest, artifact-set digests, and byte/hash verification. The unproven exact Qwen chain and
incomplete build inputs remain accepted residual evidence gaps, not admission blockers.

This partially supersedes ADR 0030 only for the WebLLM Qwen conversion withholding decision. ADR
0030's exact-artifact principle and every decision for other model stacks remain unchanged.

## Consequences

- Browser and Electron users can select WebLLM on any platform; runtime capability still requires
  WebGPU.
- WebLLM downloads only the admitted manifest artifacts and verifies them before use.
- No native inference path or hosted fallback is introduced.
- The decision proves admitted artifact identity and records the named runtime-source legal
  materials; it does not prove the exact Qwen source/license chain or hermetic rebuildability.
- Any new model family, conversion, revision, digest, or conflicting provenance evidence requires
  separate admission evidence; this decision does not lower that requirement.
