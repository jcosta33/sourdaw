# Third-Party Notices

## Desktop runtime

Desktop builds bundle [Electron 43.4.1](https://github.com/electron/electron/tree/340bae15aaef12b7e96f1c857be986aa9f65c21c)
under the MIT license. That release embeds
[Chromium 150.0.7871.224](https://chromium.googlesource.com/chromium/src/+/36bfd07adec25f5027aaecf2023b35821f30ee4e)
and [Node v24.18.1](https://github.com/nodejs/node/tree/9623d9ad85d37d2f0610ec4a82b48182cf2c6061).
Its media runtime includes
[FFmpeg](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/ad41607c61898cf7150e0fb20fe4bbabd44922a3)
under LGPL-2.1-or-later.

Every desktop package includes Electron's exact `LICENSE` as `electron-LICENSE.txt` and its complete
Chromium, Node, FFmpeg, and bundled-component notice file as `electron-LICENSES.chromium.html`. See
[ELECTRON-SOURCES.json](./ELECTRON-SOURCES.json) for package, source, release, and file hashes.

## LGPL runtimes

Sourdaw uses two LGPL packages without source modifications. FaustWasm runtime files are copied
byte-for-byte from its package. Vite bundles lamejs into Sourdaw's application code.

| Component | Version | License           | Source                                                                                                                                                                                                              |
| --------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FaustWasm | 0.16.7  | LGPL-2.1-or-later | [wrapper](https://github.com/grame-cncm/faustwasm/archive/a1ae243d885d6494409a2a4a227cbdd2a6833edf.tar.gz), [compiler](https://github.com/grame-cncm/faust/archive/011423ab76674cd96009385af15cadcd281a3259.tar.gz) |
| lamejs    | 1.2.7   | LGPL-3.0-only     | [source](https://github.com/gideonstele/lamejs/archive/1fb0ef5fa177413107e2e107d054a9b994e3f79c.tar.gz)                                                                                                             |

FaustWasm's `COPYING.txt` grants LGPL-2.1-or-later despite the package metadata naming LGPL-3.0.
Its notice is preserved. lamejs declares LGPL-3.0. The upstream notices and complete license texts
are beside this file.

FaustWasm's package source is pinned by npm `gitHead`. The bundled compiler identifies itself as
2.86.2; the matching Faust version commit is pinned, but a reproducible rebuild has not yet proven
that exact compiler commit produced the binary.

See [SOURCES.json](./SOURCES.json) for exact package, source, and file identities. See
[RELINKING.md](./RELINKING.md) to replace either library and rebuild Sourdaw.

## DDSP WebGPU runtime

The release-withheld DDSP worker uses TensorFlow.js 4.22.0 with its WebGPU backend. Its runtime
closure contains TensorFlow.js Core, Converter, WebGPU, CPU shared helpers, long, and seedrandom.
The CPU backend is not registered and is not a fallback. The worker also adapts Magenta.js's
Apache-2.0 GraphModel Roll operation.

See [TensorFlow.js-NOTICE.txt](./TensorFlow.js-NOTICE.txt),
[Magenta.js-NOTICE.txt](./Magenta.js-NOTICE.txt), [Apache-2.0.txt](./Apache-2.0.txt), and
[seedrandom-MIT.txt](./seedrandom-MIT.txt). These runtime notices do not grant or characterize the
separately downloaded DDSP checkpoint artifacts; the product admission gate remains closed.

## WebLLM Qwen models

Web and desktop builds can download three pinned MLC-format Qwen models for browser-local WebLLM
inference. The MLC cards attribute the conversions to Qwen 1.7B, 4B, and 8B models, and immutable
licensed Qwen candidate revisions support the accepted admission decision. The cards do not map the
conversions to exact checkpoint revisions, so this evidence does not prove an exact Qwen
source/license chain. The Apache-2.0 text and attribution record are in
[Apache-2.0.txt](./Apache-2.0.txt) and [Qwen-NOTICE.txt](./Qwen-NOTICE.txt).

The admitted WebGPU modules come from
[binary-mlc-llm-libs at `025bcaf3780fa8254f5e5efd3bfea0a5397248f4`](https://github.com/mlc-ai/binary-mlc-llm-libs/tree/025bcaf3780fa8254f5e5efd3bfea0a5397248f4/web-llm-models/v0_2_84/base).
The merged upstream record names MLC-LLM `2008fe8343e1f40ef89ee57b9287aebcf1b86c98`
and Apache TVM `bc1a904ec1ad89454ee6577d66cde1268b8f6bc8` as their source revisions. MLC-LLM's
exact notice and TVM's exact root license, notice, and full referenced license/notice trees are in
[MLC-LLM-NOTICE.txt](./MLC-LLM-NOTICE.txt),
[Apache-TVM/NOTICE](./Apache-TVM/NOTICE), [Apache-TVM/LICENSE](./Apache-TVM/LICENSE),
[Apache-TVM/licenses/LICENSE.blockingconcurrentqueue.txt](./Apache-TVM/licenses/LICENSE.blockingconcurrentqueue.txt),
[Apache-TVM/licenses/LICENSE.builtin_fp16.txt](./Apache-TVM/licenses/LICENSE.builtin_fp16.txt),
[Apache-TVM/licenses/LICENSE.concurrentqueue.txt](./Apache-TVM/licenses/LICENSE.concurrentqueue.txt),
[Apache-TVM/licenses/LICENSE.cutlass.txt](./Apache-TVM/licenses/LICENSE.cutlass.txt),
[Apache-TVM/licenses/LICENSE.cutlass_fpA_intB_gemm.txt](./Apache-TVM/licenses/LICENSE.cutlass_fpA_intB_gemm.txt),
[Apache-TVM/licenses/LICENSE.l2_cache_flush.txt](./Apache-TVM/licenses/LICENSE.l2_cache_flush.txt),
[Apache-TVM/licenses/LICENSE.libflash_attn.txt](./Apache-TVM/licenses/LICENSE.libflash_attn.txt),
[Apache-TVM/licenses/LICENSE.rang.txt](./Apache-TVM/licenses/LICENSE.rang.txt),
[Apache-TVM/licenses/LICENSE.tensorrt_llm.txt](./Apache-TVM/licenses/LICENSE.tensorrt_llm.txt),
[Apache-TVM/licenses/LICENSE.vllm.txt](./Apache-TVM/licenses/LICENSE.vllm.txt),
[Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt),
[Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.libbacktrace.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.libbacktrace.txt),
[Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.pytorch.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.pytorch.txt),
and [Apache-TVM/3rdparty/tvm-ffi/licenses/NOTICE.pytorch.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/NOTICE.pytorch.txt).

The exact downloaded model and WebAssembly bytes remain pinned and verified before storage or
inference. This admission does not claim hermetic reproduction: the upstream conversions do not map
to base-checkpoint revisions, and the binary merge record lacks the exact emsdk revision, resolved
build configuration, and build log. Binary byte identity and the named MLC-LLM/TVM source revisions
are proven; the exact Qwen source/license chain and complete build-input provenance are not.

## Trademarks

See [TRADEMARKS.md](./TRADEMARKS.md).
