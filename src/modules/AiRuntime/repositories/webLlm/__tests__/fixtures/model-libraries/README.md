# WebLLM model-library ABI fixtures

These are lossless gzip copies (mtime0) of the exact three model-library bytes selected by the production artifact manifest. They contain no model weights, config or tokenizer. The ABI spec verifies uncompressed size and SHA256 against that manifest before real public-runtime instantiation; it never initializes GPU, fetches artifacts, or invokes the allocation function.

Source: https://github.com/mlc-ai/binary-mlc-llm-libs/tree/146ed9cd4b4062e967b017fd2291f7106b50599f/web-llm-models/v0_2_87/base (PR168).

- `Qwen3-1.7B-q4f16_1_cs1k-webgpu.wasm`: 6589747bytes, SHA256 `363f4dbb789f0518e52295d1f4685d2d61feae4ac4e2a6a95621e4af29450bd7`; gzip 990663bytes.
- `Qwen3-4B-q4f16_1_cs1k-webgpu.wasm`: 6874869bytes, SHA256 `2afc399ed01d8ae641beac0528567c8ce22e8c9c7203ba0827c44e13c62be99c`; gzip 1028169bytes.
- `Qwen3-8B-q4f16_1_cs1k-webgpu.wasm`: 6875765bytes, SHA256 `3a8d51dc4315f056b6cffc1b8828b1a5e13d29fe096da3bf19096ac637985b81`; gzip 1029462bytes.

The test resolves runtime0.28.0-dev2 through SDK0.2.88's declared dependency. The raw SDK executable SHA256 is5460309cbb350e97fe63c817d73718588976049e7125ef66b657818a0e31818a; runtime executable SHA256 is7919d6c599b9b86da020cdd20738bbe4a2e06d5643f79f3907d07a80ca279e62. The SDK and standalone runtime RuntimeContext and Instance classes match after leading source indentation normalization. Their audited normalized SHA256s are5070a2e4f10f3f0b0b310ef8dc0a92dc747d996f44207cac8974bee35b483bb5 and97e57c7531cfd78b5801932aae0a557b894abd5be424dedfad43868f93a422a7. An SDK/runtime executable change requires a new source-equivalence and actual-binary ABI audit, not merely replacing these expected hashes.

Publisher-named sources: MLC-LLM44fd06d04f22c87820e205b0f2b2e5e6a1f6ca85 and TVMe345029cedf0be76a087fcad9c89a97bed4f7204. TVM pins TIRx198a04573ea44e060c1087c8223cf082c64a6c03, which pins FFI6628c464e3b824d09c9cf65ac0c6c24f973f6d56. Original Apache-2.0 terms and upstream/third-party notices are retained under public/legal/Apache-2.0.txt, MLC-LLM-NOTICE.txt and Apache-TVM/, as described in public/legal/THIRD-PARTY-NOTICES.md. That attribution namespace keeps FFI under Apache-TVM/3rdparty/tvm-ffi even though the upstream gitlink is nested through TIRx.

No hermetic binary rebuild is claimed: emsdk, resolved build commands/configuration, and complete conversion genealogy are not attested. No GPU/weight binding/inference or model behavior claim follows from a constructor/registry pass.

Red-first evidence used the authentic previously admitted v0_2_84 bytes and matching manifest: all three failed `Cannot find global function runtime.TensorAllocWithScope`. A mechanical regression probe restores one such old binary AND its exact manifest source/record/seal and requires the corresponding named test to fail at real instantiate, rather than merely fail the hash check. Do not update unchanged nonlibrary-input pins or add old runtime support.
