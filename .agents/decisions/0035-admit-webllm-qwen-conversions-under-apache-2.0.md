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
    - https://huggingface.co/Qwen/Qwen3-1.7B/blob/70d244cc86ccca08cf5af4e1e306ecf908b1ad5e/LICENSE
    - https://huggingface.co/Qwen/Qwen3-4B/blob/1cfa9a7208912126459214e8b04321603b3df60c/LICENSE
    - https://huggingface.co/Qwen/Qwen3-8B/blob/b968826d9c46dd6066d109eabc6255188de91218/LICENSE
    - https://github.com/mlc-ai/binary-mlc-llm-libs/pull/165
    - https://github.com/mlc-ai/binary-mlc-llm-libs/tree/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base
    - https://github.com/mlc-ai/mlc-llm/tree/2008fe8343e1f40ef89ee57b9287aebcf1b86c98
    - https://github.com/apache/tvm/tree/bc1a904ec1ad89454ee6577d66cde1268b8f6bc8
    - https://github.com/mlc-ai/web-llm/blob/9e572d6ed95e248f29634996cd32cc8f3023d89d/LICENSE
    - src/modules/AiRuntime/repositories/webLlm/webLlmArtifactManifest.generated.json
    - src/modules/AiRuntime/repositories/webLlm/webLlmArtifactAdmission.ts
    - public/legal/Qwen-NOTICE.txt
---

# 0035 - Admit pinned WebLLM Qwen conversions under Apache-2.0

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
`025bcaf3780fa8254f5e5efd3bfea0a5397248f4`. Its merged PR 165 attests MLC-LLM
`2008fe8343e1f40ef89ee57b9287aebcf1b86c98` and Apache TVM
`bc1a904ec1ad89454ee6577d66cde1268b8f6bc8` as source revisions. Sourdaw ships MLC-LLM's exact
notice and TVM's exact root license, notice, and every file in the license/notice trees referenced by
that root license. PR 165 does not record an exact emsdk revision, resolved build configuration, or
build log. The release manifest pins the exact conversion revisions and verifies every downloaded
artifact's byte count and SHA-256 before caching or inference, but the upstream record does not
support a claim of exact Qwen checkpoint provenance, hermetic reproduction, or complete build-input
provenance.

## Decision

Admit only these exact WebLLM Qwen MLC conversions:

| Qwen model | MLC conversion revision                    | Artifact-set digest                                                |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Qwen3 1.7B | `80b3abcec6c3b3f5355dc0cc99cc4fb578f192bc` | `932ad158daa0d6814a50c5fb6aa85f88c3d3892a58a0dc20d47ff0b9e6e0b255` |
| Qwen3 4B   | `a5c9fab855e3ccbdfed2e7e69683d75f30332161` | `2438f2a6b58372e12ca0aa949443a49ca7b6060ad3e7971aed0d56b49a35195f` |
| Qwen3 8B   | `b3d55c289eae58f77095f5b68c895eeea358ee09` | `7e7da9410d3b7cdeea46c0c2f417e560e54a2c736e8474e04b85e466e41022bb` |

The corresponding immutable licensed Qwen candidate revisions are
`70d244cc86ccca08cf5af4e1e306ecf908b1ad5e` (1.7B),
`1cfa9a7208912126459214e8b04321603b3df60c` (4B), and
`b968826d9c46dd6066d109eabc6255188de91218` (8B). Together with the conversion cards' attribution,
they support the accepted admission decision; they do not prove that the upstream conversions used
those exact checkpoints or establish an exact Qwen source/license chain.

The admitted WebGPU modules remain exactly:

| Model      | Binary path                                                       |     Bytes | SHA-256                                                            |
| ---------- | ----------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| Qwen3 1.7B | `web-llm-models/v0_2_84/base/Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm` | 5,566,554 | `8161aaa4b40bccf19fcedb2f2e8c221eb9efb72d2198681f1958c9c1e05a682f` |
| Qwen3 4B   | `web-llm-models/v0_2_84/base/Qwen3-4B-q4f16_1_cs1k-webgpu.wasm`   | 5,847,049 | `a986a53c92579714eb7ec36856004f5fb75272c9f69091f14eb6b2086eea4440` |
| Qwen3 8B   | `web-llm-models/v0_2_84/base/Qwen3-8B-q4f16_1_cs1k-webgpu.wasm`   | 5,855,792 | `bf6384d9b30d6ae1eca567c65a893284ae2228fd57a432c3b795d06a803d9b72` |

`MODEL_RELEASE_ADMISSION.webLlm` admits these artifacts on both browser and Electron targets. An
explicit WebLLM selection remains exclusive: absent WebGPU it is unavailable and never falls back to
a hosted provider. Automatic mode also fails closed when WebLLM is unavailable; hosted providers
require an explicit selection.

Every web and desktop release carries the Apache-2.0 text and Qwen attribution, MLC-LLM's
exact-revision notice, and TVM's exact root license, notice, and referenced license/notice trees under
`public/legal/`. The release must preserve the pinned revisions, generated manifest, artifact-set
digests, and byte/hash verification. The unproven exact Qwen chain and incomplete build inputs remain
accepted residual evidence gaps, not admission blockers.

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
