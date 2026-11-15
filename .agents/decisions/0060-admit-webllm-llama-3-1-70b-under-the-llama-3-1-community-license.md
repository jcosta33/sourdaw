---
type: adr
id: 0060
title: Admit pinned WebLLM Llama 3.1 70B under the Llama 3.1 Community License
status: accepted
date: 2026-11-15
decided: 2026-11-12
owner: The Sourdaw team
sources:
    - https://huggingface.co/mlc-ai/Llama-3.1-70B-Instruct-q3f16_1-MLC/tree/9d30b348cad6c840c8568ae585e1690f19f4338c
    - https://github.com/mlc-ai/binary-mlc-llm-libs/tree/146ed9cd4b4062e967b017fd2291f7106b50599f/web-llm-models/v0_2_87/base
    - https://github.com/meta-llama/llama-models/blob/1f0feb795a4130697ced243fb53051670d591653/models/llama3_1/LICENSE
    - https://github.com/meta-llama/llama-models/blob/1f0feb795a4130697ced243fb53051670d591653/models/llama3_1/USE_POLICY.md
    - https://www.llama.com/llama3_1/license/
    - https://www.llama.com/llama3_1/use-policy/
    - src/modules/AiRuntime/repositories/webLlm/webLlmArtifactManifest.generated.json
    - src/modules/AiRuntime/repositories/webLlm/webLlmModelAdmissions.ts
    - public/legal/Llama-NOTICE.txt
    - public/legal/Llama-3.1-LICENSE.txt
    - public/legal/Llama-3.1-ACCEPTABLE-USE-POLICY.txt
---

# 0060 - Admit pinned WebLLM Llama 3.1 70B under the Llama 3.1 Community License

## Context

The local WebLLM catalogue has three Qwen tiers (ADR 0037). Qwen3-8B plans project edits; nothing
larger is offered to a machine with the memory for it. Meta's Llama 3.1 70B Instruct is the largest
prebuilt conversion `@mlc-ai/web-llm` 0.2.88 lists (`Llama-3.1-70B-Instruct-q3f16_1-MLC`, library
`v0_2_87/base/Llama-3_1-70B-Instruct-q3f16_1_cs1k-webgpu.wasm`, `vram_required_MB` 31153.13,
`low_resource_required` false, recorded window 4,096). The owner decided on 2026-11-12 to offer it as a
fourth tier, "Large".

Unlike the Qwen models (Apache-2.0), Llama 3.1 is under the Llama 3.1 Community License, a bespoke
licence with no SPDX identifier we can verify. This record names it `LicenseRef-Llama-3.1-Community-License`.
The MLC card attributes the conversion to `meta-llama/Meta-Llama-3.1-70B-Instruct` but, as for Qwen, does
not map the conversion to an exact base-checkpoint revision. That evidence gap is accepted.

The licence text and Acceptable Use Policy shipped are the immutable copies at
`meta-llama/llama-models` commit `1f0feb795a4130697ced243fb53051670d591653` (`models/llama3_1/LICENSE`,
SHA-256 `bf2eac60b81e5c5f779fc3b4849d3bfacfd63f97f3eb68b44e9c6868c5801712`; `USE_POLICY.md`, SHA-256
`f456a3f5b15ab588c84d06cf095a245bfee0bbc1620b48ed00af2cca4a711735`), whose clauses match Meta's page
https://www.llama.com/llama3_1/license/ fetched on 2026-11-15.

## Decision

Admit only this exact WebLLM Llama MLC conversion:

| Llama model            | MLC conversion revision                    | Artifact-set digest                                                |
| ---------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| Llama 3.1 70B Instruct | `9d30b348cad6c840c8568ae585e1690f19f4338c` | `c5b181b8df7e33660d14aba38131081bab344cfd09f6f6616df93b69b0023ff0` |

The admitted WebGPU module comes from binary-mlc-llm-libs merge `146ed9cd4b4062e967b017fd2291f7106b50599f`,
the same library revision ADR 0037 admits for the Qwen models:

| Model                  | Binary path                                                                   |     Bytes | SHA-256                                                            |
| ---------------------- | ----------------------------------------------------------------------------- | --------: | ------------------------------------------------------------------ |
| Llama 3.1 70B Instruct | `web-llm-models/v0_2_87/base/Llama-3_1-70B-Instruct-q3f16_1_cs1k-webgpu.wasm` | 9,541,090 | `db78950bc873f57c08f03298091069e2b0aa0c9c1eb89d1d625c57fe9bea9c31` |

The licence identifier recorded in the admission is `LicenseRef-Llama-3.1-Community-License`.

The model is offered as the Large tier and plans project edits like Pro. Its window is the 32,768 tokens
Pro loads with, so every request Pro can plan fits. It is admitted exactly like the Qwen models: pinned
revision, byte and SHA-256 verification of every artifact, consent before download, storage check, and
the `shader-f16` requirement (q3f16 keeps activations in float16).

Sizes: the download is 31,795,408,181 bytes (~31.80 GB). Memory is web-llm's `vram_required_MB`
31153.13 MiB at its recorded 4,096-token window plus the KV cache for the 28,672 tokens the model loads
beyond it: 80 layers, 8 KV heads, head dimension 128, float16 cache, 0.3125 MiB per token, giving
40,113.13 MiB, 42.06 GB, shown as ~42.1 GB. The picker lists Large only when the machine's reported
memory clears that figure; without a memory figure it is hidden.

### Licence duties and how they are met

- A copy of the agreement travels with the model: `public/legal/Llama-3.1-LICENSE.txt`, byte-identical to
  the pinned upstream file, shipped in web and desktop builds.
- "Built with Llama" is displayed on the Large card in the model picker and in the download consent line,
  with the licence name.
- `public/legal/Llama-NOTICE.txt` carries the required attribution notice exactly: "Llama 3.1 is licensed
  under the Llama 3.1 Community License, Copyright © Meta Platforms, Inc. All Rights Reserved."
- Use follows Meta's Acceptable Use Policy, incorporated by reference: `public/legal/Llama-3.1-ACCEPTABLE-USE-POLICY.txt`
  ships beside the agreement and the consent line points to both.
- The naming duty (a model name starting with "Llama") applies to a model trained or improved with Llama
  outputs; Sourdaw trains none, so it does not apply.
- The 700 million monthly active user clause is noted: Sourdaw is far below it, and a change in that
  position requires a fresh licence decision before the model is offered further.
- The "Llama" mark is used only as the attribution duty requires, per Meta's brand guidelines.

### Accepted evidence gap

The MLC conversion repository does not map the conversion to an exact `Meta-Llama-3.1-70B-Instruct`
checkpoint revision, and the library build record has the same gaps ADR 0037 records. Neither blocks
admission.

## Consequences

- Machines with at least 42.1 GB of reported memory see a fourth tier, Large; no other machine's picker
  changes, and Automatic routing and the default model (Qwen3-8B) are unchanged.
- No existing Qwen digest moves.
- Any new revision, digest, or conflicting licence or provenance evidence for this model requires a new
  admission record; it does not lower the requirement for any other model.
