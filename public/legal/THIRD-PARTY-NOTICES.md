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

The DDSP worker uses TensorFlow.js 4.22.0 with its WebGPU backend. Its runtime
closure contains TensorFlow.js Core, Converter, WebGPU, CPU shared helpers, long, and seedrandom.
The CPU backend is not registered and is not a fallback. The worker also adapts Magenta.js's
Apache-2.0 GraphModel Roll operation.

See [TensorFlow.js-NOTICE.txt](./TensorFlow.js-NOTICE.txt),
[Magenta.js-NOTICE.txt](./Magenta.js-NOTICE.txt), [Apache-2.0.txt](./Apache-2.0.txt), and
[seedrandom-MIT.txt](./seedrandom-MIT.txt). These runtime notices do not grant or characterize the
separately downloaded DDSP checkpoint artifacts. The checkpoint license remains unverified.
Sourdaw does not bundle or redistribute those artifacts; the user's browser downloads the exact
pinned bytes directly from Magenta only after an explicit download action and verifies them before
publication or use.

## Trademarks

See [TRADEMARKS.md](./TRADEMARKS.md).
