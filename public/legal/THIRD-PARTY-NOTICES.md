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

## TensorFlow.js runtime

Browser and desktop DDSP rendering includes the exact ten-package closure recorded in
[TensorFlow.js-NOTICE.txt](./TensorFlow.js-NOTICE.txt). Most of the closure is Apache-2.0, but
`@tensorflow/tfjs-layers` is dual-licensed under Apache-2.0 AND MIT and `seedrandom` is MIT.

The complete shared Apache text is [Apache-2.0.txt](./Apache-2.0.txt). The exact upstream
TensorFlow.js Layers dual-license file, with its copyrights, is
[TensorFlow.js-Layers-LICENSE.txt](./TensorFlow.js-Layers-LICENSE.txt). The exact `seedrandom`
and bundled Alea MIT notices are [seedrandom-MIT.txt](./seedrandom-MIT.txt).

This attribution applies to the TensorFlow.js runtime only. It does not state or imply that the
separately downloaded Magenta DDSP checkpoint weights are licensed under Apache-2.0.

## Magenta.js DDSP code basis

Sourdaw's DDSP worker adapts feature conditioning, chunk overlap/crossfade, post-gain, and the
GraphModel `Roll` operation from Magenta.js at immutable revision
`0692eb2b79681f062c6b6dd53a0361967f298caa`. The upstream source files retain Google's copyright
notice and are licensed under Apache License 2.0.

See [Magenta.js-NOTICE.txt](./Magenta.js-NOTICE.txt) for the exact files, revision, copyright, and
adaptation scope. The complete license is [Apache-2.0.txt](./Apache-2.0.txt).

This code attribution is separate from the downloaded Magenta DDSP checkpoint weights. Sourdaw does
not describe those weights as Apache-2.0.

## Trademarks

See [TRADEMARKS.md](./TRADEMARKS.md).
