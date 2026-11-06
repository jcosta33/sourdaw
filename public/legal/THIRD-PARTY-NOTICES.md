# Third-Party Notices

## Desktop runtime

Desktop builds bundle [Electron 44.9.1](https://github.com/electron/electron/tree/e02265be96c5e13ae43644ef482b718e1e800499)
under the MIT license. That release embeds
[Chromium 152.0.7977.167](https://chromium.googlesource.com/chromium/src/+/dd78960ccd8a03a2fe1f629543d27783885b78e9)
and [Node v24.22.0](https://github.com/nodejs/node/tree/f14cd3aa7bf9ca8df2cc5b8bb14beb0f335b1d93).
Its media runtime includes
[FFmpeg](https://chromium.googlesource.com/chromium/third_party/ffmpeg/+/2b68d2babae73714846961fb0ee47e3b3d2e39a9)
under LGPL-2.1-or-later.

Every desktop package includes Electron's exact `LICENSE` as `electron-LICENSE.txt` and its complete
Chromium, Node, FFmpeg, and bundled-component notice file as `electron-LICENSES.chromium.html`. See
[ELECTRON-SOURCES.json](./ELECTRON-SOURCES.json) for package, source, release, and file hashes.

## LGPL runtimes

Sourdaw uses two LGPL packages without source modifications. FaustWasm runtime files are copied
byte-for-byte from its package. Vite bundles lamejs into Sourdaw's application code.

| Component | Version | License           | Source                                                                                                                                                                                                              |
| --------- | ------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FaustWasm | 0.18.5  | LGPL-2.1-or-later | [wrapper](https://github.com/grame-cncm/faustwasm/archive/ba611eaeefcb41f935cab1481ea9580b470ae8eb.tar.gz), [compiler](https://github.com/grame-cncm/faust/archive/ada86ab32fe875f5d1d028c3a99f17e3a83e0ad8.tar.gz) |
| lamejs    | 1.2.7   | LGPL-3.0-only     | [source](https://github.com/gideonstele/lamejs/archive/1fb0ef5fa177413107e2e107d054a9b994e3f79c.tar.gz)                                                                                                             |

FaustWasm's `COPYING.txt` grants LGPL-2.1-or-later despite the package metadata naming LGPL-3.0.
Its notice is preserved. lamejs declares LGPL-3.0. The upstream notices and complete license texts
are beside this file.

FaustWasm's package source is pinned by npm `gitHead`. The bundled compiler identifies itself as
2.89.2; the matching Faust version commit is pinned, but a reproducible rebuild has not yet proven
that exact compiler commit produced the binary.

See [SOURCES.json](./SOURCES.json) for exact package, source, and file identities. See
[RELINKING.md](./RELINKING.md) to replace either library and rebuild Sourdaw.

## JavaScript and Rust dependencies

[DEPENDENCY-LICENSES.txt](./DEPENDENCY-LICENSES.txt) binds `pnpm-lock.yaml`, the standalone server's
`package-lock.json`, and the normal-dependency `Cargo.lock` graph to each package's declared license
expression, retained legal files, or an explicit assembled license record. Assembled records pair
hash-pinned lock-resolved metadata with canonical SPDX text; they do not authenticate package-specific
attribution. Checked proof archives are separately authenticated. Generation fails when configured
records are missing or inconsistent. Platform-restricted build auxiliaries are excluded; Electron's
platform legal bundle remains authoritative for its shipped runtime.

The report identifies exact registry packages and versions, including the MPL-2.0 Rust packages
whose corresponding source is available from those same crates.io package versions. Dedicated
runtime notices below remain authoritative for their narrower component closures.

## Adapted DSP source

`crates/daw-dsp/src/toaster/engines/kick_808.rs` adapts mi-plaits-dsp-rs at commit
`6d3f7a5b84b25ec45d66c9f6be7109474690d795` under the MIT license. Copyright (c) 2022 Oliver
Rockstedt. The exact upstream terms are in [MI-PLAITS-DSP-RS-MIT.txt](./MI-PLAITS-DSP-RS-MIT.txt).

That port identifies Mutable Instruments Plaits firmware 1.2 as its original source. The adapted
analog bass-drum source is pinned to `pichenettes/eurorack` commit
`99432f2bf443219b3eb77e65e1a18583faad422e`, file
`plaits/dsp/drums/analog_bass_drum.h`, SHA-256
`46e03e356685b20e7444b6979ad61579d962f4a4a08a748142fdc497ecaa23ea`. Copyright 2016 Emilie
Gillet. Its exact MIT license header is in
[MUTABLE-INSTRUMENTS-PLAITS-MIT.txt](./MUTABLE-INSTRUMENTS-PLAITS-MIT.txt).

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
[Apache-TVM/3rdparty/tvm-ffi/NOTICE](./Apache-TVM/3rdparty/tvm-ffi/NOTICE),
[Apache-TVM/3rdparty/tvm-ffi/LICENSE](./Apache-TVM/3rdparty/tvm-ffi/LICENSE),
[Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.dlpack.txt),
[Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.libbacktrace.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.libbacktrace.txt),
[Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.pytorch.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/LICENSE.pytorch.txt),
and [Apache-TVM/3rdparty/tvm-ffi/licenses/NOTICE.pytorch.txt](./Apache-TVM/3rdparty/tvm-ffi/licenses/NOTICE.pytorch.txt).

The exact downloaded model and WebAssembly bytes remain pinned and verified before storage or
inference. This admission does not claim hermetic reproduction: the upstream conversions do not map
to base-checkpoint revisions, and the binary merge record lacks the exact emsdk revision, resolved
build configuration, and build log. Binary byte identity and the named MLC-LLM/TVM source revisions
are proven; the exact Qwen source/license chain and complete build-input provenance are not.

## Plugin interfaces

Sourdaw hosts CLAP and VST®3 plugins by declaring each format's interfaces through the `clap-sys` and
`vst3` crates. It bundles no plugin-format SDK and redistributes no plugin. Those crates ship their own
authors' MIT and Apache-2.0 texts but no notice from the interface authors, so the notices those
interfaces require are reproduced in
[PLUGIN-INTERFACE-NOTICES.txt](./PLUGIN-INTERFACE-NOTICES.txt).

## Trademarks

See [TRADEMARKS.md](./TRADEMARKS.md).


Codec runtime redistribution notice appendix proposal

This retains a conservative complete notice-source envelope for the mapped linked/generated source families. It does not assert every listed source was linked. The accompanying exact link/header/JS coverage records identify observed inputs. Existing project notices must be retained. No binary is attributed solely to its npm wrapper MIT license.


===== Original audiojs Vorbis wrapper MIT =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-current-codec-lifecycle-continuity-admission-sol/sources/@audio--encode-ogg/package/LICENSE
SHA256: 5402845d71ed23b7815f3ea1a75bf2f69bff920639db873ff3cc65cc7033a15a

MIT License

Copyright (c) 2026 Dmitry Iv.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


===== Original audiojs Opus wrapper MIT =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-current-codec-lifecycle-continuity-admission-sol/sources/@audio--encode-opus/package/LICENSE
SHA256: 5402845d71ed23b7815f3ea1a75bf2f69bff920639db873ff3cc65cc7033a15a

MIT License

Copyright (c) 2026 Dmitry Iv.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


===== Original wasm-media wrapper/glue MIT =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-current-codec-lifecycle-continuity-admission-sol/sources/wasm-media-encoders/package/LICENSE
SHA256: 7f766c19bc26ca14d9dad1bf102211f12b0a5c139f66e1132a9867fcfa04bdf0

MIT License

Copyright (c) 2020-2024 arseneyr

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.


===== Inlined SWC helpers Apache-2.0 =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-current-codec-lifecycle-continuity-admission-sol/sources/@swc--helpers/package/LICENSE
SHA256: d96eba1f1881334d50ffc144276dfa98e147a415e7c591ecdfcb81680361dc91

                              Apache License
                        Version 2.0, January 2004
                     http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

   "License" shall mean the terms and conditions for use, reproduction,
   and distribution as defined by Sections 1 through 9 of this document.

   "Licensor" shall mean the copyright owner or entity authorized by
   the copyright owner that is granting the License.

   "Legal Entity" shall mean the union of the acting entity and all
   other entities that control, are controlled by, or are under common
   control with that entity. For the purposes of this definition,
   "control" means (i) the power, direct or indirect, to cause the
   direction or management of such entity, whether by contract or
   otherwise, or (ii) ownership of fifty percent (50%) or more of the
   outstanding shares, or (iii) beneficial ownership of such entity.

   "You" (or "Your") shall mean an individual or Legal Entity
   exercising permissions granted by this License.

   "Source" form shall mean the preferred form for making modifications,
   including but not limited to software source code, documentation
   source, and configuration files.

   "Object" form shall mean any form resulting from mechanical
   transformation or translation of a Source form, including but
   not limited to compiled object code, generated documentation,
   and conversions to other media types.

   "Work" shall mean the work of authorship, whether in Source or
   Object form, made available under the License, as indicated by a
   copyright notice that is included in or attached to the work
   (an example is provided in the Appendix below).

   "Derivative Works" shall mean any work, whether in Source or Object
   form, that is based on (or derived from) the Work and for which the
   editorial revisions, annotations, elaborations, or other modifications
   represent, as a whole, an original work of authorship. For the purposes
   of this License, Derivative Works shall not include works that remain
   separable from, or merely link (or bind by name) to the interfaces of,
   the Work and Derivative Works thereof.

   "Contribution" shall mean any work of authorship, including
   the original version of the Work and any modifications or additions
   to that Work or Derivative Works thereof, that is intentionally
   submitted to Licensor for inclusion in the Work by the copyright owner
   or by an individual or Legal Entity authorized to submit on behalf of
   the copyright owner. For the purposes of this definition, "submitted"
   means any form of electronic, verbal, or written communication sent
   to the Licensor or its representatives, including but not limited to
   communication on electronic mailing lists, source code control systems,
   and issue tracking systems that are managed by, or on behalf of, the
   Licensor for the purpose of discussing and improving the Work, but
   excluding communication that is conspicuously marked or otherwise
   designated in writing by the copyright owner as "Not a Contribution."

   "Contributor" shall mean Licensor and any individual or Legal Entity
   on behalf of whom a Contribution has been received by Licensor and
   subsequently incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   copyright license to reproduce, prepare Derivative Works of,
   publicly display, publicly perform, sublicense, and distribute the
   Work and such Derivative Works in Source or Object form.

3. Grant of Patent License. Subject to the terms and conditions of
   this License, each Contributor hereby grants to You a perpetual,
   worldwide, non-exclusive, no-charge, royalty-free, irrevocable
   (except as stated in this section) patent license to make, have made,
   use, offer to sell, sell, import, and otherwise transfer the Work,
   where such license applies only to those patent claims licensable
   by such Contributor that are necessarily infringed by their
   Contribution(s) alone or by combination of their Contribution(s)
   with the Work to which such Contribution(s) was submitted. If You
   institute patent litigation against any entity (including a
   cross-claim or counterclaim in a lawsuit) alleging that the Work
   or a Contribution incorporated within the Work constitutes direct
   or contributory patent infringement, then any patent licenses
   granted to You under this License for that Work shall terminate
   as of the date such litigation is filed.

4. Redistribution. You may reproduce and distribute copies of the
   Work or Derivative Works thereof in any medium, with or without
   modifications, and in Source or Object form, provided that You
   meet the following conditions:

   (a) You must give any other recipients of the Work or
       Derivative Works a copy of this License; and

   (b) You must cause any modified files to carry prominent notices
       stating that You changed the files; and

   (c) You must retain, in the Source form of any Derivative Works
       that You distribute, all copyright, patent, trademark, and
       attribution notices from the Source form of the Work,
       excluding those notices that do not pertain to any part of
       the Derivative Works; and

   (d) If the Work includes a "NOTICE" text file as part of its
       distribution, then any Derivative Works that You distribute must
       include a readable copy of the attribution notices contained
       within such NOTICE file, excluding those notices that do not
       pertain to any part of the Derivative Works, in at least one
       of the following places: within a NOTICE text file distributed
       as part of the Derivative Works; within the Source form or
       documentation, if provided along with the Derivative Works; or,
       within a display generated by the Derivative Works, if and
       wherever such third-party notices normally appear. The contents
       of the NOTICE file are for informational purposes only and
       do not modify the License. You may add Your own attribution
       notices within Derivative Works that You distribute, alongside
       or as an addendum to the NOTICE text from the Work, provided
       that such additional attribution notices cannot be construed
       as modifying the License.

   You may add Your own copyright statement to Your modifications and
   may provide additional or different license terms and conditions
   for use, reproduction, or distribution of Your modifications, or
   for any such Derivative Works as a whole, provided Your use,
   reproduction, and distribution of the Work otherwise complies with
   the conditions stated in this License.

5. Submission of Contributions. Unless You explicitly state otherwise,
   any Contribution intentionally submitted for inclusion in the Work
   by You to the Licensor shall be under the terms and conditions of
   this License, without any additional terms or conditions.
   Notwithstanding the above, nothing herein shall supersede or modify
   the terms of any separate license agreement you may have executed
   with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
   names, trademarks, service marks, or product names of the Licensor,
   except as required for reasonable and customary use in describing the
   origin of the Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or
   agreed to in writing, Licensor provides the Work (and each
   Contributor provides its Contributions) on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
   implied, including, without limitation, any warranties or conditions
   of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
   PARTICULAR PURPOSE. You are solely responsible for determining the
   appropriateness of using or redistributing the Work and assume any
   risks associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory,
   whether in tort (including negligence), contract, or otherwise,
   unless required by applicable law (such as deliberate and grossly
   negligent acts) or agreed to in writing, shall any Contributor be
   liable to You for damages, including any direct, indirect, special,
   incidental, or consequential damages of any character arising as a
   result of this License or out of the use or inability to use the
   Work (including but not limited to damages for loss of goodwill,
   work stoppage, computer failure or malfunction, or any and all
   other commercial damages or losses), even if such Contributor
   has been advised of the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing
   the Work or Derivative Works thereof, You may choose to offer,
   and charge a fee for, acceptance of support, warranty, indemnity,
   or other liability obligations and/or rights consistent with this
   License. However, in accepting such obligations, You may act only
   on Your own behalf and on Your sole responsibility, not on behalf
   of any other Contributor, and only if You agree to indemnify,
   defend, and hold each Contributor harmless for any liability
   incurred by, or claims asserted against, such Contributor by reason
   of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS

APPENDIX: How to apply the Apache License to your work.

   To apply the Apache License to your work, attach the following
   boilerplate notice, with the fields enclosed by brackets "[]"
   replaced with your own identifying information. (Don't include
   the brackets!)  The text should be enclosed in the appropriate
   comment syntax for the file format. We also recommend that a
   file or class name and description of purpose be included on the
   same "printed page" as the copyright notice for easier
   identification within third-party archives.

Copyright 2024 SWC contributors.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

	http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.

===== Pinned codec source notice envelope =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-pinned-runtime-build-admission-sol/sources/codec-notice-anthology.txt
SHA256: 3839441df01121e645ca1c22275413afac25034029d66f7e77b9621f34d7a10a

Source(s): libogg/COPYING

Copyright (c) 2002, Xiph.org Foundation

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Source(s): libogg/include/ogg/ogg.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation http://www.xiph.org/                  *
 *                                                                  *
 ********************************************************************

 function: toplevel libogg include

 ********************************************************************/

Source(s): libogg/include/ogg/os_types.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2002             *
 * by the Xiph.Org Foundation http://www.xiph.org/                  *
 *                                                                  *
 ********************************************************************

 function: Define a consistent set of types on each platform.

 ********************************************************************/

Source(s): libogg/src/bitwise.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE Ogg CONTAINER SOURCE CODE.              *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2014             *
 * by the Xiph.Org Foundation http://www.xiph.org/                  *
 *                                                                  *
 ********************************************************************

  function: packing variable sized words into an octet stream

 ********************************************************************/

Source(s): libogg/src/crctable.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE Ogg CONTAINER SOURCE CODE.              *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2018             *
 * by the Xiph.Org Foundation http://www.xiph.org/                  *
 *                                                                  *
 ********************************************************************/

Source(s): libogg/src/framing.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE Ogg CONTAINER SOURCE CODE.              *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2018             *
 * by the Xiph.Org Foundation http://www.xiph.org/                  *
 *                                                                  *
 ********************************************************************

 function: code raw packets into framed OggSquish stream and
           decode Ogg streams back into raw packets

 note: The CRC code is directly derived from public domain code by
 Ross Williams (ross@guest.adelaide.edu.au).  See docs/framing.html
 for details.

 ********************************************************************/

Source(s): libogg/src/framing.c

/* Copy in the submitted packet.  Yes, the copy is a waste; this is
     the liability of overly clean abstraction for the time being.  It
     will actually be fairly easy to eliminate the extra copy in the
     future */

Source(s): libvorbis/COPYING

Copyright (c) 2002-2020 Xiph.org Foundation

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Source(s): libvorbis/debian/copyright

This package was debianized by Christopher L Cheney <ccheney@debian.org> on
Tue, 31 Oct 2000 15:08:22 -0600.

It was downloaded from https://downloads.xiph.org/releases/vorbis/

Upstream Author: Monty <monty@xiph.org>

Copyright:

Copyright (c) 2020, Xiph.org Foundation

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of the Xiph.org Foundation nor the names of its
contributors may be used to endorse or promote products derived from
this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE REGENTS OR
CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Source(s): libvorbis/include/vorbis/codec.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2001             *
 * by the Xiph.Org Foundation https://xiph.org/                     *

 ********************************************************************

 function: libvorbis codec headers

 ********************************************************************/

Source(s): libvorbis/include/vorbis/vorbisenc.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2001             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: vorbis encode-engine setup

 ********************************************************************/

Source(s): libvorbis/include/vorbis/vorbisfile.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: stdio-based convenience library for opening/seeking/decoding

 ********************************************************************/

Source(s): libvorbis/lib/analysis.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: single-block PCM analysis mode dispatch

 ********************************************************************/

Source(s): libvorbis/lib/backends.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: libvorbis backend and mapping structures; needed for
           static mode headers

 ********************************************************************/

Source(s): libvorbis/lib/barkmel.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: bark scale utility

 ********************************************************************/

Source(s): libvorbis/lib/bitrate.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: bitrate tracking and management

 ********************************************************************/

Source(s): libvorbis/lib/bitrate.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: bitrate tracking and management

 ********************************************************************/

Source(s): libvorbis/lib/block.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: PCM data vector blocking, windowing and dis/reassembly

 Handle windowing, overlap-add, etc of the PCM vectors.  This is made
 more amusing by Vorbis' current two allowed block sizes.

 ********************************************************************/

Source(s): libvorbis/lib/books/coupled/res_books_51.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2010             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************
 *
 * function: static codebooks for 5.1 surround
 *
 ********************************************************************/

Source(s): libvorbis/lib/books/coupled/res_books_stereo.h, libvorbis/lib/books/floor/floor_books.h, libvorbis/lib/books/uncoupled/res_books_uncoupled.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: static codebooks autogenerated by huff/huffbuld

 ********************************************************************/

Source(s): libvorbis/lib/codebook.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: basic codebook pack/unpack/code/decode operations

 ********************************************************************/

Source(s): libvorbis/lib/codebook.h, libvorbis/lib/sharedbook.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: basic shared codebook operations

 ********************************************************************/

Source(s): libvorbis/lib/codec_internal.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: libvorbis codec headers

 ********************************************************************/

Source(s): libvorbis/lib/envelope.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: PCM data envelope analysis

 ********************************************************************/

Source(s): libvorbis/lib/envelope.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: PCM data envelope analysis and manipulation

 ********************************************************************/

Source(s): libvorbis/lib/floor0.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: floor backend 0 implementation

 ********************************************************************/

Source(s): libvorbis/lib/floor1.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: floor backend 1 implementation

 ********************************************************************/

Source(s): libvorbis/lib/highlevel.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: highlevel encoder setup struct separated out for vorbisenc clarity

 ********************************************************************/

Source(s): libvorbis/lib/info.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: maintain the info structure, info <-> header packets

 ********************************************************************/

Source(s): libvorbis/lib/lookup.c, libvorbis/lib/lookup.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

  function: lookup based functions

 ********************************************************************/

Source(s): libvorbis/lib/lookup_data.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

  function: lookup data; generated by lookups.pl; edit there

 ********************************************************************/

Source(s): libvorbis/lib/lpc.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

  function: LPC low level routines

 ********************************************************************/

Source(s): libvorbis/lib/lpc.c

/* Some of these routines (autocorrelator, LPC coefficient estimator)
   are derived from code written by Jutta Degener and Carsten Bormann;
   thus we include their copyright below.  The entirety of this file
   is freely redistributable on the condition that both of these
   copyright notices are preserved without modification.  */

Source(s): libvorbis/lib/lpc.c

/* Preserved Copyright: *********************************************/

Source(s): libvorbis/lib/lpc.c

/* Copyright 1992, 1993, 1994 by Jutta Degener and Carsten Bormann,
Technische Universita"t Berlin

Any use of this software is permitted provided that this notice is not
removed and that neither the authors nor the Technische Universita"t
Berlin are deemed to have made any representations as to the
suitability of this software for any purpose nor are held responsible
for any defects of this software. THERE IS ABSOLUTELY NO WARRANTY FOR
THIS SOFTWARE.

As a matter of courtesy, the authors request to be informed about uses
this software has found, about bugs in this software, and about any
improvements that may be of general interest.

Berlin, 28.11.1994
Jutta Degener
Carsten Bormann

*********************************************************************/

Source(s): libvorbis/lib/lpc.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

  function: LPC low level routines

 ********************************************************************/

Source(s): libvorbis/lib/lsp.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

  function: LSP (also called LSF) conversion routines

  The LSP generation code is taken (with minimal modification and a
  few bugfixes) from "On the Computation of the LSP Frequencies" by
  Joseph Rothweiler (see http://www.rothweiler.us for contact info).

  The paper is available at:

  https://web.archive.org/web/20110810174000/http://home.myfairpoint.net/vzenxj75/myown1/joe/lsf/index.html

 ********************************************************************/

Source(s): libvorbis/lib/lsp.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

  function: LSP (also called LSF) conversion routines

 ********************************************************************/

Source(s): libvorbis/lib/mapping0.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2010             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: channel mapping 0 implementation

 ********************************************************************/

Source(s): libvorbis/lib/masking.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: masking curve data for psychoacoustics

 ********************************************************************/

Source(s): libvorbis/lib/mdct.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: normalized modified discrete cosine transform
           power of two length transform only [64 <= n ]

 Original algorithm adapted long ago from _The use of multirate filter
 banks for coding of high quality digital audio_, by T. Sporer,
 K. Brandenburg and B. Edler, collection of the European Signal
 Processing Conference (EUSIPCO), Amsterdam, June 1992, Vol.1, pp
 211-214

 The below code implements an algorithm that no longer looks much like
 that presented in the paper, but the basic structure remains if you
 dig deep enough to see it.

 This module DOES NOT INCLUDE code to generate/apply the window
 function.  Everybody has their own weird favorite including me... I
 happen to like the properties of y=sin(.5PI*sin^2(x)), but others may
 vehemently disagree.

 ********************************************************************/

Source(s): libvorbis/lib/mdct.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: modified discrete cosine transform prototypes

 ********************************************************************/

Source(s): libvorbis/lib/misc.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************/

Source(s): libvorbis/lib/misc.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: miscellaneous prototypes

 ********************************************************************/

Source(s): libvorbis/lib/modes/floor_all.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: key floor settings

 ********************************************************************/

Source(s): libvorbis/lib/modes/psych_11.h, libvorbis/lib/modes/setup_11.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: 11kHz settings

 ********************************************************************/

Source(s): libvorbis/lib/modes/psych_16.h, libvorbis/lib/modes/setup_16.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: 16kHz settings

 ********************************************************************/

Source(s): libvorbis/lib/modes/psych_44.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: key psychoacoustic settings for 44.1/48kHz

 ********************************************************************/

Source(s): libvorbis/lib/modes/psych_8.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: 8kHz psychoacoustic settings

 ********************************************************************/

Source(s): libvorbis/lib/modes/residue_16.h

/********************************************************************
 *                                                                  *
 * This FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel residue templates 16/22kHz

 ********************************************************************/

Source(s): libvorbis/lib/modes/residue_44.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel residue templates for 32/44.1/48kHz

 ********************************************************************/

Source(s): libvorbis/lib/modes/residue_44p51.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2010             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel residue templates for 32/44.1/48kHz uncoupled

 ********************************************************************/

Source(s): libvorbis/lib/modes/residue_44u.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel residue templates for 32/44.1/48kHz uncoupled

 ********************************************************************/

Source(s): libvorbis/lib/modes/residue_8.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel residue templates 8/11kHz

 ********************************************************************/

Source(s): libvorbis/lib/modes/setup_22.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: 22kHz settings

 ********************************************************************/

Source(s): libvorbis/lib/modes/setup_32.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel settings for 32kHz

 ********************************************************************/

Source(s): libvorbis/lib/modes/setup_44.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel settings for 44.1/48kHz

 ********************************************************************/

Source(s): libvorbis/lib/modes/setup_44p51.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2010             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel settings for 44.1/48kHz 5.1 surround modes

 ********************************************************************/

Source(s): libvorbis/lib/modes/setup_44u.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: toplevel settings for 44.1/48kHz uncoupled modes

 ********************************************************************/

Source(s): libvorbis/lib/modes/setup_8.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: 8kHz settings

 ********************************************************************/

Source(s): libvorbis/lib/modes/setup_X.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: catch-all toplevel settings for q modes only

 ********************************************************************/

Source(s): libvorbis/lib/os.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: #ifdef jail to whip a few platforms into the UNIX ideal.

 ********************************************************************/

Source(s): libvorbis/lib/psy.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2010             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: psychoacoustics not including preecho

 ********************************************************************/

Source(s): libvorbis/lib/psy.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: random psychoacoustics (not including preecho)

 ********************************************************************/

Source(s): libvorbis/lib/psytune.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: simple utility that runs audio through the psychoacoustics
           without encoding

 ********************************************************************/

Source(s): libvorbis/lib/registry.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: registry for time, floor, res backends and channel mappings

 ********************************************************************/

Source(s): libvorbis/lib/registry.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: registry for time, floor, res backends and channel mappings

 ********************************************************************/

Source(s): libvorbis/lib/res0.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2010             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: residue backend 0, 1 and 2 implementation

 ********************************************************************/

Source(s): libvorbis/lib/scales.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: linear scale -> dB, Bark and Mel scales

 ********************************************************************/

Source(s): libvorbis/lib/smallft.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: *unnormalized* fft transform

 ********************************************************************/

Source(s): libvorbis/lib/smallft.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: fft transform

 ********************************************************************/

Source(s): libvorbis/lib/synthesis.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: single-block PCM synthesis

 ********************************************************************/

Source(s): libvorbis/lib/vorbisenc.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: simple programmatic interface for encoder mode setup

 ********************************************************************/

Source(s): libvorbis/lib/vorbisfile.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2015             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: stdio-based convenience library for opening/seeking/decoding

 ********************************************************************/

Source(s): libvorbis/lib/window.c

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2009             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: window functions

 ********************************************************************/

Source(s): libvorbis/lib/window.h

/********************************************************************
 *                                                                  *
 * THIS FILE IS PART OF THE OggVorbis SOFTWARE CODEC SOURCE CODE.   *
 * USE, DISTRIBUTION AND REPRODUCTION OF THIS LIBRARY SOURCE IS     *
 * GOVERNED BY A BSD-STYLE SOURCE LICENSE INCLUDED WITH THIS SOURCE *
 * IN 'COPYING'. PLEASE READ THESE TERMS BEFORE DISTRIBUTING.       *
 *                                                                  *
 * THE OggVorbis SOURCE CODE IS (C) COPYRIGHT 1994-2007             *
 * by the Xiph.Org Foundation https://xiph.org/                     *
 *                                                                  *
 ********************************************************************

 function: window functions

 ********************************************************************/

Source(s): libopus/COPYING

Copyright 2001-2023 Xiph.Org, Skype Limited, Octasic,
                    Jean-Marc Valin, Timothy B. Terriberry,
                    CSIRO, Gregory Maxwell, Mark Borgerding,
                    Erik de Castro Lopo, Mozilla, Amazon

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

- Redistributions of source code must retain the above copyright
notice, this list of conditions and the following disclaimer.

- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.

- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

Opus is subject to the royalty-free patent licenses which are
specified at:

Xiph.Org Foundation:
https://datatracker.ietf.org/ipr/1524/

Microsoft Corporation:
https://datatracker.ietf.org/ipr/1914/

Broadcom Corporation:
https://datatracker.ietf.org/ipr/1526/

Source(s): libopus/LICENSE_PLEASE_READ.txt

Contributions to the collaboration shall not be considered confidential.

Each contributor represents and warrants that it has the right and
authority to license copyright in its contributions to the collaboration.

Each contributor agrees to license the copyright in the contributions
under the Modified (2-clause or 3-clause) BSD License or the Clear BSD License.

Please see the IPR statements submitted to the IETF for the complete
patent licensing details:

Xiph.Org Foundation:
https://datatracker.ietf.org/ipr/1524/

Microsoft Corporation:
https://datatracker.ietf.org/ipr/1914/

Skype Limited:
https://datatracker.ietf.org/ipr/1602/

Broadcom Corporation:
https://datatracker.ietf.org/ipr/1526/

Source(s): libopus/celt/_kiss_fft_guts.h

/*Copyright (c) 2003-2004, Mark Borgerding

  All rights reserved.

  Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
       this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
       this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
  POSSIBILITY OF SUCH DAMAGE.*/

Source(s): libopus/celt/arch.h

/* Copyright (c) 2003-2008 Jean-Marc Valin
   Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Written by Jean-Marc Valin */

Source(s): libopus/celt/arch.h, libopus/celt/arm/arm_celt_map.c, libopus/celt/arm/armcpu.c, libopus/celt/arm/armcpu.h, libopus/celt/arm/celt_fft_ne10.c, libopus/celt/arm/celt_mdct_ne10.c, libopus/celt/arm/celt_neon_intr.c, libopus/celt/arm/fft_arm.h, libopus/celt/arm/fixed_arm64.h, libopus/celt/arm/fixed_armv4.h, libopus/celt/arm/fixed_armv5e.h, libopus/celt/arm/mathops_arm.h, libopus/celt/arm/mdct_arm.h, libopus/celt/arm/pitch_arm.h, libopus/celt/bands.c, libopus/celt/bands.h, libopus/celt/celt.c, libopus/celt/celt.h, libopus/celt/celt_decoder.c, libopus/celt/celt_encoder.c, libopus/celt/celt_lpc.c, libopus/celt/celt_lpc.h, libopus/celt/cpu_support.h, libopus/celt/cwrs.c, libopus/celt/cwrs.h, libopus/celt/dump_modes/dump_modes.c, libopus/celt/dump_modes/dump_modes_arch.h, libopus/celt/dump_modes/dump_modes_arm_ne10.c, libopus/celt/ecintrin.h, libopus/celt/entcode.c, libopus/celt/entcode.h, libopus/celt/entdec.c, libopus/celt/entdec.h, libopus/celt/entenc.c, libopus/celt/entenc.h, libopus/celt/fixed_c5x.h, libopus/celt/fixed_c6x.h, libopus/celt/fixed_debug.h, libopus/celt/fixed_generic.h, libopus/celt/float_cast.h, libopus/celt/laplace.c, libopus/celt/laplace.h, libopus/celt/mathops.c, libopus/celt/mathops.h, libopus/celt/mdct.c, libopus/celt/mdct.h, libopus/celt/mfrngcod.h, libopus/celt/mips/celt_mipsr1.h, libopus/celt/mips/fixed_generic_mipsr1.h, libopus/celt/mips/mdct_mipsr1.h, libopus/celt/mips/pitch_mipsr1.h, libopus/celt/modes.c, libopus/celt/modes.h, libopus/celt/opus_custom_demo.c, libopus/celt/pitch.c, libopus/celt/pitch.h, libopus/celt/quant_bands.c, libopus/celt/quant_bands.h, libopus/celt/rate.c, libopus/celt/rate.h, libopus/celt/stack_alloc.h, libopus/celt/vq.c, libopus/celt/vq.h, libopus/celt/x86/pitch_avx.c, libopus/celt/x86/pitch_sse.h, libopus/celt/x86/vq_sse.h, libopus/celt/x86/vq_sse2.c, libopus/include/opus.h, libopus/include/opus_custom.h, libopus/include/opus_defines.h, libopus/include/opus_multistream.h, libopus/include/opus_projection.h, libopus/include/opus_types.h, libopus/src/extensions.c, libopus/src/mapping_matrix.c, libopus/src/mapping_matrix.h, libopus/src/opus.c, libopus/src/opus_compare.c, libopus/src/opus_decoder.c, libopus/src/opus_demo.c, libopus/src/opus_encoder.c, libopus/src/opus_multistream.c, libopus/src/opus_multistream_decoder.c, libopus/src/opus_multistream_encoder.c, libopus/src/opus_private.h, libopus/src/opus_projection_decoder.c, libopus/src/opus_projection_encoder.c, libopus/src/qext_compare.c, libopus/src/repacketizer.c, libopus/src/repacketizer_demo.c

/*
   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions
   are met:

   - Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

   - Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
   ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
   OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
   EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
   PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
   PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
   LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
   NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

Source(s): libopus/celt/arm/arm_celt_map.c

/* Copyright (c) 2010 Xiph.Org Foundation
 * Copyright (c) 2013 Parrot
 * Copyright (c) 2024 Arm Limited */

Source(s): libopus/celt/arm/armcpu.c, libopus/celt/arm/armcpu.h, libopus/celt/arm/pitch_arm.h, libopus/celt/cpu_support.h

/* Copyright (c) 2010 Xiph.Org Foundation
 * Copyright (c) 2013 Parrot */

Source(s): libopus/celt/arm/celt_fft_ne10.c, libopus/celt/arm/celt_mdct_ne10.c, libopus/celt/arm/fft_arm.h, libopus/celt/arm/mdct_arm.h, libopus/celt/dump_modes/dump_modes_arch.h, libopus/celt/dump_modes/dump_modes_arm_ne10.c

/* Copyright (c) 2015 Xiph.Org Foundation
   Written by Viswanath Puttagunta */

Source(s): libopus/celt/arm/celt_neon_intr.c

/* Copyright (c) 2014-2015 Xiph.Org Foundation
   Copyright (c) 2024 Arm Limited
   Written by Viswanath Puttagunta */

Source(s): libopus/celt/arm/fixed_arm64.h

/* Copyright (C) 2015 Vidyo */

Source(s): libopus/celt/arm/fixed_armv4.h

/* Copyright (C) 2013 Xiph.Org Foundation and contributors */

Source(s): libopus/celt/arm/fixed_armv5e.h

/* Copyright (C) 2007-2009 Xiph.Org Foundation
   Copyright (C) 2003-2008 Jean-Marc Valin
   Copyright (C) 2007-2008 CSIRO
   Copyright (C) 2013      Parrot */

Source(s): libopus/celt/arm/kiss_fft_armv4.h, libopus/celt/arm/kiss_fft_armv5e.h, libopus/celt/mips/kiss_fft_mipsr1.h

/*Copyright (c) 2013, Xiph.Org Foundation and contributors.

  All rights reserved.

  Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
       this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
       this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
  POSSIBILITY OF SUCH DAMAGE.*/

Source(s): libopus/celt/arm/mathops_arm.h

/* Copyright (c) 2024 Arm Limited */

Source(s): libopus/celt/arm/pitch_neon_intr.c, libopus/silk/arm/LPC_inv_pred_gain_arm.h, libopus/silk/arm/LPC_inv_pred_gain_neon_intr.c, libopus/silk/arm/NSQ_del_dec_arm.h, libopus/silk/arm/NSQ_del_dec_neon_intr.c, libopus/silk/arm/biquad_alt_arm.h, libopus/silk/arm/biquad_alt_neon_intr.c, libopus/silk/fixed/arm/warped_autocorrelation_FIX_arm.h

/***********************************************************************
Copyright (c) 2017 Google Inc.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/celt/bands.c, libopus/celt/bands.h

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Copyright (c) 2008-2009 Gregory Maxwell
   Written by Jean-Marc Valin and Gregory Maxwell */

Source(s): libopus/celt/celt.c, libopus/celt/celt_decoder.c, libopus/celt/celt_encoder.c, libopus/celt/mips/celt_mipsr1.h

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2010 Xiph.Org Foundation
   Copyright (c) 2008 Gregory Maxwell
   Written by Jean-Marc Valin and Gregory Maxwell */

Source(s): libopus/celt/celt.h, libopus/celt/modes.c, libopus/celt/modes.h

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Copyright (c) 2008 Gregory Maxwell
   Written by Jean-Marc Valin and Gregory Maxwell */

Source(s): libopus/celt/celt_lpc.c, libopus/celt/celt_lpc.h

/* Copyright (c) 2009-2010 Xiph.Org Foundation
   Written by Jean-Marc Valin */

Source(s): libopus/celt/cwrs.c, libopus/celt/cwrs.h

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Copyright (c) 2007-2009 Timothy B. Terriberry
   Written by Timothy B. Terriberry and Jean-Marc Valin */

Source(s): libopus/celt/dump_modes/dump_modes.c

/* Copyright (c) 2008 CSIRO
   Copyright (c) 2008-2009 Xiph.Org Foundation
   Written by Jean-Marc Valin */

Source(s): libopus/celt/ecintrin.h

/* Copyright (c) 2003-2008 Timothy B. Terriberry
   Copyright (c) 2008 Xiph.Org Foundation */

Source(s): libopus/celt/entcode.c

/* Copyright (c) 2001-2011 Timothy B. Terriberry
*/

Source(s): libopus/celt/entcode.h, libopus/celt/entdec.c, libopus/celt/entdec.h, libopus/celt/entenc.c, libopus/celt/entenc.h

/* Copyright (c) 2001-2011 Timothy B. Terriberry
   Copyright (c) 2008-2009 Xiph.Org Foundation */

Source(s): libopus/celt/fixed_c5x.h

/* Copyright (C) 2003 Jean-Marc Valin */

Source(s): libopus/celt/fixed_c6x.h

/* Copyright (C) 2008 CSIRO */

Source(s): libopus/celt/fixed_debug.h

/* Copyright (C) 2003-2008 Jean-Marc Valin
   Copyright (C) 2007-2012 Xiph.Org Foundation */

Source(s): libopus/celt/fixed_generic.h, libopus/celt/mips/fixed_generic_mipsr1.h

/* Copyright (C) 2007-2009 Xiph.Org Foundation
   Copyright (C) 2003-2008 Jean-Marc Valin
   Copyright (C) 2007-2008 CSIRO */

Source(s): libopus/celt/float_cast.h

/* Copyright (C) 2001 Erik de Castro Lopo <erikd AT mega-nerd DOT com> */

Source(s): libopus/celt/kiss_fft.c, libopus/celt/kiss_fft.h

/*Copyright (c) 2003-2004, Mark Borgerding
  Lots of modifications by Jean-Marc Valin
  Copyright (c) 2005-2007, Xiph.Org Foundation
  Copyright (c) 2008,      Xiph.Org Foundation, CSIRO

  All rights reserved.

  Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are met:

    * Redistributions of source code must retain the above copyright notice,
       this list of conditions and the following disclaimer.
    * Redistributions in binary form must reproduce the above copyright notice,
       this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
  AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
  IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
  ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
  LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
  CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
  SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
  INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
  CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
  ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
  POSSIBILITY OF SUCH DAMAGE.*/

Source(s): libopus/celt/laplace.c, libopus/celt/laplace.h

/* Copyright (c) 2007 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Written by Jean-Marc Valin */

Source(s): libopus/celt/mathops.c

/* Copyright (c) 2002-2008 Jean-Marc Valin
   Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Copyright (c) 2024 Arm Limited
   Written by Jean-Marc Valin */

Source(s): libopus/celt/mathops.h

/* Copyright (c) 2002-2008 Jean-Marc Valin
   Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Copyright (c) 2024 Arm Limited
   Written by Jean-Marc Valin, and Yunho Huh */

Source(s): libopus/celt/mdct.c, libopus/celt/mdct.h, libopus/celt/mips/mdct_mipsr1.h

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2008 Xiph.Org Foundation
   Written by Jean-Marc Valin */

Source(s): libopus/celt/mfrngcod.h

/* Copyright (c) 2001-2008 Timothy B. Terriberry
   Copyright (c) 2008-2009 Xiph.Org Foundation */

Source(s): libopus/celt/mini_kfft.c

/*
 *  Copyright (c) 2003-2010, Mark Borgerding. All rights reserved.
 *  This file is part of KISS FFT - https://github.com/mborgerding/kissfft
 *
 *  SPDX-License-Identifier: BSD-3-Clause
 *  See COPYING file for more information.
 */

Source(s): libopus/celt/mips/pitch_mipsr1.h, libopus/celt/opus_custom_demo.c, libopus/celt/pitch.c, libopus/celt/pitch.h, libopus/celt/quant_bands.c, libopus/celt/quant_bands.h, libopus/celt/rate.c, libopus/celt/rate.h, libopus/celt/vq.c, libopus/celt/vq.h, libopus/src/opus_demo.c

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Written by Jean-Marc Valin */

Source(s): libopus/celt/os_support.h

/* Copyright (C) 2007 Jean-Marc Valin

   File: os_support.h
   This is the (tiny) OS abstraction layer. Aside from math.h, this is the
   only place where system headers are allowed.

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions are
   met:

   1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.

   2. Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

   THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
   IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
   OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
   DISCLAIMED. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT,
   INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
   (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
   SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
   HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT,
   STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
   ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
   POSSIBILITY OF SUCH DAMAGE.
*/

Source(s): libopus/celt/rate.c

/* Never skip the first band, nor a band that has been boosted by
          dynalloc.
         In the first case, we'd be coding a bit to signal we're going to waste
          all the other bits.
         In the second case, we'd be coding a bit to redistribute all the bits
          we just signaled should be concentrated in this band. */

Source(s): libopus/celt/stack_alloc.h

/* Copyright (C) 2002-2003 Jean-Marc Valin
   Copyright (C) 2007-2009 Xiph.Org Foundation */

Source(s): libopus/celt/x86/celt_lpc_sse.h, libopus/celt/x86/celt_lpc_sse4_1.c, libopus/celt/x86/pitch_sse.c, libopus/celt/x86/pitch_sse2.c, libopus/celt/x86/pitch_sse4_1.c, libopus/celt/x86/x86_celt_map.c, libopus/celt/x86/x86cpu.c, libopus/celt/x86/x86cpu.h, libopus/silk/fixed/x86/vector_ops_FIX_sse4_1.c, libopus/silk/x86/SigProc_FIX_sse.h, libopus/silk/x86/main_sse.h, libopus/silk/x86/x86_silk_map.c

/* Copyright (c) 2014, Cisco Systems, INC
   Written by XiangMingZhu WeiZhou MinPeng YanWang

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions
   are met:

   - Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

   - Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
   ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
   OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
   EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
   PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
   PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
   LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
   NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

Source(s): libopus/celt/x86/pitch_avx.c, libopus/celt/x86/x86_arch_macros.h

/* Copyright (c) 2023 Amazon */

Source(s): libopus/celt/x86/pitch_sse.h

/* Copyright (c) 2013 Jean-Marc Valin and John Ridges
   Copyright (c) 2014, Cisco Systems, INC MingXiang WeiZhou MinPeng YanWang*/

Source(s): libopus/celt/x86/vq_sse.h

/* Copyright (c) 2016  Jean-Marc Valin */

Source(s): libopus/celt/x86/vq_sse2.c

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Copyright (c) 2007-2016 Jean-Marc Valin */

Source(s): libopus/celt/x86/x86_arch_macros.h, libopus/src/analysis.c, libopus/src/analysis.h, libopus/src/mlp.c, libopus/src/mlp.h

/*
   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions
   are met:

   - Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

   - Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
   ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
   A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE FOUNDATION OR
   CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
   EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
   PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
   PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
   LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
   NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

Source(s): libopus/include/opus.h, libopus/include/opus_defines.h, libopus/src/opus_encoder.c

/* Copyright (c) 2010-2011 Xiph.Org Foundation, Skype Limited
   Written by Jean-Marc Valin and Koen Vos */

Source(s): libopus/include/opus_custom.h

/* Copyright (c) 2007-2008 CSIRO
   Copyright (c) 2007-2009 Xiph.Org Foundation
   Copyright (c) 2008-2012 Gregory Maxwell
   Written by Jean-Marc Valin and Gregory Maxwell */

Source(s): libopus/include/opus_multistream.h, libopus/src/analysis.c, libopus/src/analysis.h, libopus/src/opus_multistream.c, libopus/src/opus_multistream_decoder.c, libopus/src/opus_multistream_encoder.c, libopus/src/repacketizer.c, libopus/src/repacketizer_demo.c

/* Copyright (c) 2011 Xiph.Org Foundation
   Written by Jean-Marc Valin */

Source(s): libopus/include/opus_projection.h, libopus/src/mapping_matrix.c, libopus/src/mapping_matrix.h, libopus/src/opus_projection_decoder.c, libopus/src/opus_projection_encoder.c

/* Copyright (c) 2017 Google Inc.
   Written by Andrew Allen */

Source(s): libopus/include/opus_types.h

/* (C) COPYRIGHT 1994-2002 Xiph.Org Foundation */

Source(s): libopus/silk/A2NLSF.c, libopus/silk/API.h, libopus/silk/CNG.c, libopus/silk/HP_variable_cutoff.c, libopus/silk/Inlines.h, libopus/silk/LPC_analysis_filter.c, libopus/silk/LPC_inv_pred_gain.c, libopus/silk/LP_variable_cutoff.c, libopus/silk/MacroCount.h, libopus/silk/NLSF2A.c, libopus/silk/NLSF_VQ.c, libopus/silk/NLSF_VQ_weights_laroia.c, libopus/silk/NLSF_decode.c, libopus/silk/NLSF_del_dec_quant.c, libopus/silk/NLSF_encode.c, libopus/silk/NLSF_stabilize.c, libopus/silk/NLSF_unpack.c, libopus/silk/NSQ.c, libopus/silk/NSQ_del_dec.c, libopus/silk/PLC.c, libopus/silk/PLC.h, libopus/silk/SigProc_FIX.h, libopus/silk/VAD.c, libopus/silk/VQ_WMat_EC.c, libopus/silk/ana_filt_bank_1.c, libopus/silk/biquad_alt.c, libopus/silk/bwexpander.c, libopus/silk/bwexpander_32.c, libopus/silk/check_control_input.c, libopus/silk/code_signs.c, libopus/silk/control.h, libopus/silk/control_SNR.c, libopus/silk/control_audio_bandwidth.c, libopus/silk/control_codec.c, libopus/silk/debug.c, libopus/silk/debug.h, libopus/silk/dec_API.c, libopus/silk/decode_core.c, libopus/silk/decode_frame.c, libopus/silk/decode_indices.c, libopus/silk/decode_parameters.c, libopus/silk/decode_pitch.c, libopus/silk/decode_pulses.c, libopus/silk/decoder_set_fs.c, libopus/silk/define.h, libopus/silk/enc_API.c, libopus/silk/encode_indices.c, libopus/silk/encode_pulses.c, libopus/silk/errors.h, libopus/silk/fixed/LTP_analysis_filter_FIX.c, libopus/silk/fixed/LTP_scale_ctrl_FIX.c, libopus/silk/fixed/apply_sine_window_FIX.c, libopus/silk/fixed/autocorr_FIX.c, libopus/silk/fixed/burg_modified_FIX.c, libopus/silk/fixed/corrMatrix_FIX.c, libopus/silk/fixed/encode_frame_FIX.c, libopus/silk/fixed/find_LPC_FIX.c, libopus/silk/fixed/find_LTP_FIX.c, libopus/silk/fixed/find_pitch_lags_FIX.c, libopus/silk/fixed/find_pred_coefs_FIX.c, libopus/silk/fixed/k2a_FIX.c, libopus/silk/fixed/k2a_Q16_FIX.c, libopus/silk/fixed/main_FIX.h, libopus/silk/fixed/mips/warped_autocorrelation_FIX_mipsr1.h, libopus/silk/fixed/noise_shape_analysis_FIX.c, libopus/silk/fixed/pitch_analysis_core_FIX.c, libopus/silk/fixed/process_gains_FIX.c, libopus/silk/fixed/regularize_correlations_FIX.c, libopus/silk/fixed/residual_energy16_FIX.c, libopus/silk/fixed/residual_energy_FIX.c, libopus/silk/fixed/schur64_FIX.c, libopus/silk/fixed/schur_FIX.c, libopus/silk/fixed/structs_FIX.h, libopus/silk/fixed/vector_ops_FIX.c, libopus/silk/fixed/warped_autocorrelation_FIX.c, libopus/silk/float/LPC_analysis_filter_FLP.c, libopus/silk/float/LPC_inv_pred_gain_FLP.c, libopus/silk/float/LTP_analysis_filter_FLP.c, libopus/silk/float/LTP_scale_ctrl_FLP.c, libopus/silk/float/SigProc_FLP.h, libopus/silk/float/apply_sine_window_FLP.c, libopus/silk/float/autocorrelation_FLP.c, libopus/silk/float/burg_modified_FLP.c, libopus/silk/float/bwexpander_FLP.c, libopus/silk/float/corrMatrix_FLP.c, libopus/silk/float/encode_frame_FLP.c, libopus/silk/float/energy_FLP.c, libopus/silk/float/find_LPC_FLP.c, libopus/silk/float/find_LTP_FLP.c, libopus/silk/float/find_pitch_lags_FLP.c, libopus/silk/float/find_pred_coefs_FLP.c, libopus/silk/float/inner_product_FLP.c, libopus/silk/float/k2a_FLP.c, libopus/silk/float/main_FLP.h, libopus/silk/float/noise_shape_analysis_FLP.c, libopus/silk/float/pitch_analysis_core_FLP.c, libopus/silk/float/process_gains_FLP.c, libopus/silk/float/regularize_correlations_FLP.c, libopus/silk/float/residual_energy_FLP.c, libopus/silk/float/scale_copy_vector_FLP.c, libopus/silk/float/scale_vector_FLP.c, libopus/silk/float/schur_FLP.c, libopus/silk/float/sort_FLP.c, libopus/silk/float/structs_FLP.h, libopus/silk/float/warped_autocorrelation_FLP.c, libopus/silk/float/wrappers_FLP.c, libopus/silk/gain_quant.c, libopus/silk/init_decoder.c, libopus/silk/init_encoder.c, libopus/silk/inner_prod_aligned.c, libopus/silk/interpolate.c, libopus/silk/lin2log.c, libopus/silk/log2lin.c, libopus/silk/macros.h, libopus/silk/main.h, libopus/silk/mips/NSQ_mips.h, libopus/silk/mips/macros_mipsr1.h, libopus/silk/mips/sigproc_fix_mipsr1.h, libopus/silk/pitch_est_defines.h, libopus/silk/pitch_est_tables.c, libopus/silk/process_NLSFs.c, libopus/silk/quant_LTP_gains.c, libopus/silk/resampler.c, libopus/silk/resampler_down2.c, libopus/silk/resampler_down2_3.c, libopus/silk/resampler_private.h, libopus/silk/resampler_private_AR2.c, libopus/silk/resampler_private_IIR_FIR.c, libopus/silk/resampler_private_down_FIR.c, libopus/silk/resampler_private_up2_HQ.c, libopus/silk/resampler_rom.c, libopus/silk/resampler_rom.h, libopus/silk/resampler_structs.h, libopus/silk/shell_coder.c, libopus/silk/sigm_Q15.c, libopus/silk/sort.c, libopus/silk/stereo_LR_to_MS.c, libopus/silk/stereo_MS_to_LR.c, libopus/silk/stereo_decode_pred.c, libopus/silk/stereo_encode_pred.c, libopus/silk/stereo_find_predictor.c, libopus/silk/stereo_quant_pred.c, libopus/silk/structs.h, libopus/silk/sum_sqr_shift.c, libopus/silk/table_LSF_cos.c, libopus/silk/tables.h, libopus/silk/tables_LTP.c, libopus/silk/tables_NLSF_CB_NB_MB.c, libopus/silk/tables_NLSF_CB_WB.c, libopus/silk/tables_gain.c, libopus/silk/tables_other.c, libopus/silk/tables_pitch_lag.c, libopus/silk/tables_pulses_per_block.c, libopus/silk/tuning_parameters.h, libopus/silk/typedef.h

/***********************************************************************
Copyright (c) 2006-2011, Skype Limited. All rights reserved.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/LPC_fit.c

/***********************************************************************
Copyright (c) 2013, Koen Vos. All rights reserved.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/MacroDebug.h

/***********************************************************************
Copyright (c) 2006-2011, Skype Limited. All rights reserved.
Copyright (C) 2012 Xiph.Org Foundation
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/NSQ.h

/***********************************************************************
Copyright (c) 2014 Vidyo.
Copyright (c) 2006-2011, Skype Limited. All rights reserved.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/arm/NSQ_neon.c, libopus/silk/arm/NSQ_neon.h, libopus/silk/arm/arm_silk_map.c

/***********************************************************************
Copyright (C) 2014 Vidyo
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/arm/SigProc_FIX_armv4.h

/***********************************************************************
Copyright (C) 2013 Xiph.Org Foundation and contributors
Copyright (c) 2013       Parrot
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/arm/SigProc_FIX_armv5e.h, libopus/silk/arm/macros_armv5e.h

/***********************************************************************
Copyright (c) 2006-2011, Skype Limited. All rights reserved.
Copyright (c) 2013       Parrot
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/arm/macros_arm64.h

/***********************************************************************
Copyright (C) 2015 Vidyo
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/arm/macros_armv4.h

/***********************************************************************
Copyright (C) 2013 Xiph.Org Foundation and contributors.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/fixed/arm/warped_autocorrelation_FIX_neon_intr.c

/***********************************************************************
Copyright (c) 2017 Google Inc., Jean-Marc Valin
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/fixed/x86/burg_modified_FIX_sse4_1.c, libopus/silk/x86/NSQ_del_dec_sse4_1.c, libopus/silk/x86/NSQ_sse4_1.c, libopus/silk/x86/VAD_sse4_1.c, libopus/silk/x86/VQ_WMat_EC_sse4_1.c

/* Copyright (c) 2014-2020, Cisco Systems, INC
   Written by XiangMingZhu WeiZhou MinPeng YanWang FrancisQuiers

   Redistribution and use in source and binary forms, with or without
   modification, are permitted provided that the following conditions
   are met:

   - Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.

   - Redistributions in binary form must reproduce the above copyright
   notice, this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.

   THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
   ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
   LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
   A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER
   OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
   EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO,
   PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR
   PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF
   LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING
   NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
   SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/

Source(s): libopus/silk/float/x86/inner_product_FLP_avx2.c

/***********************************************************************
Copyright (c) 2006-2011, Skype Limited. All rights reserved.
              2023 Amazon
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/x86/NSQ_del_dec_avx2.c

/***********************************************************************
Copyright (c) 2021 Google Inc.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/silk/xtensa/SigProc_FIX_lx7.h, libopus/silk/xtensa/macros_lx7.h

/***********************************************************************
Copyright (C) 2025 Xiph.Org Foundation and contributors.
Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:
- Redistributions of source code must retain the above copyright notice,
this list of conditions and the following disclaimer.
- Redistributions in binary form must reproduce the above copyright
notice, this list of conditions and the following disclaimer in the
documentation and/or other materials provided with the distribution.
- Neither the name of Internet Society, IETF or IETF Trust, nor the
names of specific contributors, may be used to endorse or promote
products derived from this software without specific prior written
permission.
THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
***********************************************************************/

Source(s): libopus/src/extensions.c

/* Copyright (c) 2022 Amazon */

Source(s): libopus/src/mlp.c

/* Copyright (c) 2008-2011 Octasic Inc.
                 2012-2017 Jean-Marc Valin */

Source(s): libopus/src/mlp.h

/* Copyright (c) 2017 Jean-Marc Valin */

Source(s): libopus/src/opus.c

/* Copyright (c) 2011 Xiph.Org Foundation, Skype Limited
   Copyright (c) 2024 Arm Limited
   Written by Jean-Marc Valin and Koen Vos */

Source(s): libopus/src/opus_compare.c, libopus/src/qext_compare.c

/* Copyright (c) 2011-2012 Xiph.Org Foundation, Mozilla Corporation
   Written by Jean-Marc Valin and Timothy B. Terriberry */

Source(s): libopus/src/opus_decoder.c

/* Copyright (c) 2010 Xiph.Org Foundation, Skype Limited
   Copyright (c) 2024 Arm Limited
   Written by Jean-Marc Valin and Koen Vos */

Source(s): libopus/src/opus_private.h

/* Copyright (c) 2012 Xiph.Org Foundation
   Written by Jean-Marc Valin */


===== Pinned Emscripten/musl/compiler-rt/JS source notice envelope =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-pinned-runtime-build-admission-sol/sources/runtime-notice-anthology.txt
SHA256: 6ff4104f168351fe7cf9afc4b09dcbfaf7c4c0655e3e2007a27750ba3c8a60ff

Source(s): AUTHORS

Contributors to Emscripten may optionally add themselves to this list of
authors if they choose to do so. This is optional because the git history is
good enough for that purpose, and in fact most projects do not maintain such a
manual list.

While the file is not necessary, to preserve the history of the project we are
not removing it.

(Authors keep copyright of their contributions, of course; they just grant
a license to everyone to use it as detailed in LICENSE.)

* Alon Zakai <alonzakai@gmail.com> (copyright owned by Mozilla Foundation and Google, Inc.)
* Tim Dawborn <tim.dawborn@gmail.com>
* Max Shawabkeh <max99x@gmail.com>
* Sigmund Vik <sigmund_vik@yahoo.com>
* Jeff Terrace <jterrace@gmail.com>
* Benoit Tremblay <trembl.ben@gmail.com>
* Andreas Bergmeier <abergmeier@gmx.net>
* Ben Schwartz <bens@alum.mit.edu>
* David Claughton <dave@eclecticdave.com>
* David Yip <yipdw@member.fsf.org>
* Julien Hamaide <julien.hamaide@gmail.com>
* Ehsan Akhgari <ehsan.akhgari@gmail.com> (copyright owned by Mozilla Foundation)
* Adrian Taylor <adrian@macrobug.com>
* Richard Assar <richard.assar@gmail.com>
* Nathan Hammond <emscripten@nathanhammond.com>
* Behdad Esfahbod <behdad@behdad.org>
* David Benjamin <davidben@mit.edu>
* Pierre Renaux <pierre@talansoft.com>
* Brian Anderson <banderson@mozilla.com>
* Jon Bardin <diclophis@gmail.com>
* Jukka Jylänki <jujjyl@gmail.com>
* Aleksander Guryanov <caiiiycuk@gmail.com>
* Chad Austin <chad@chadaustin.me> (copyright owned by IMVU)
* nandhp <nandhp@gmail.com>
* YeZhongWen <linghuye2.0@gmail.com>
* Xingxing Pan <forandom@gmail.com>
* Justin Kerk <dopefishjustin@gmail.com>
* Andrea Bedini <andrea.bedini@gmail.com>
* James Pike <totoro.friend@chilon.net>
* Mokhtar Naamani <mokhtar.naamani@gmail.com>
* Benjamin Stover <benjamin.stover@gmail.com>
* Riccardo Magliocchetti <riccardo.magliocchetti@gmail.com>
* Janus Troelsen <janus.troelsen@stud.tu-darmstadt.de>
* Lars Schneider <lars.schneider@autodesk.com> (copyright owned by Autodesk, Inc.)
* Joel Martin <github@martintribe.org>
* Manuel Wellmann <manuel.wellmann@autodesk.com> (copyright owned by Autodesk, Inc.)
* Xuejie Xiao <xxuejie@gmail.com>
* Dominic Wong <dom@slowbunyip.org>
* Alan Kligman <alan.kligman@gmail.com> (copyright owned by Mozilla Foundation)
* Anthony Liot <wolfviking0@yahoo.com>
* Michael Riss <Michael.Riss@gmx.de>
* Jasper St. Pierre <jstpierre@mecheye.net>
* Manuel Schölling <manuel.schoelling@gmx.de>
* Bruce Mitchener, Jr. <bruce.mitchener@gmail.com>
* Michael Bishop <mbtyke@gmail.com>
* Roger Braun <roger@rogerbraun.net>
* Vladimir Vukicevic <vladimir@pobox.com> (copyright owned by Mozilla Foundation)
* Lorant Pinter <lorant.pinter@prezi.com>
* Tobias Doerffel <tobias.doerffel@gmail.com>
* Martin von Gagern <martin@von-gagern.net>
* Ting-Yuan Huang <thuang@mozilla.com>
* Joshua Granick <jgranick@blackberry.com>
* Felix H. Dahlke <fhd@ubercode.de>
* Éloi Rivard <azmeuk@gmail.com>
* Alexander Gladysh <ag@logiceditor.com>
* Arlo Breault <arlolra@gmail.com>
* Jacob Lee <artdent@gmail.com> (copyright owned by Google, Inc.)
* Joe Lee <jlee@imvu.com> (copyright owned by IMVU)
* Andy Friesen <andy@imvu.com> (copyright owned by IMVU)
* Bill Welden <bwelden@imvu.com> (copyright owned by IMVU)
* Michael Ey <mey@imvu.com> (copyright owned by IMVU)
* Llorens Marti Garcia <lgarcia@imvu.com> (copyright owned by IMVU)
* Jinsuck Kim <jkim@imvu.com> (copyright owned by IMVU)
* Todd Lee <tlee@imvu.com> (copyright owned by IMVU)
* Anthony Pesch <inolen@gmail.com>
* Robert Bragg <robert.bragg@intel.com> (copyright owned by Intel Corporation)
* Sylvestre Ledru <sylvestre@debian.org>
* Tom Fairfield <fairfield@cs.xu.edu>
* Anthony J. Thibault <ajt@hyperlogic.org>
* John Allwine <jallwine86@gmail.com>
* Martin Gerhardy <martin.gerhardy@gmail.com>
* James Gregory <jgregory@zynga.com> (copyright owned by Zynga, Inc.)
* Dan Gohman <sunfish@google.com> (copyright owned by Google, Inc.)
* Jeff Gilbert <jgilbert@mozilla.com> (copyright owned by Mozilla Foundation)
* Frits Talbot <frits@metapathy.com>
* Onno Jongbloed <hey@onnoj.net>
* Jez Ng <me@jezng.com>
* Marc Feeley <mfeeley@mozilla.com> (copyright owned by Mozilla Foundation)
* Ludovic Perrine <jazzzz@gmail.com>
* David Barksdale <david.barksdale@adcedosolutions.com>
* Manfred Manik Nerurkar <nerurkar*at*made-apps.biz> (copyright owned by MADE, GmbH)
* Joseph Gentle <me@josephg.com>
* Douglas T. Crosher <dtc-moz@scieneer.com> (copyright owned by Mozilla Foundation)
* Douglas T. Crosher <info@jsstats.com> (copyright owned by Scieneer Pty Ltd.)
* Soeren Balko <soeren.balko@gmail.com> (copyright owned by Clipchamp Pty Ltd.)
* Ryan Kelly (ryan@rfk.id.au)
* Michael Lelli <toadking@toadking.com>
* Yu Kobayashi <yukoba@accelart.jp>
* Pin Zhang <zhangpin04@gmail.com>
* Nick Bray <ncbray@chromium.org> (copyright owned by Google, Inc.)
* Aidan Hobson Sayers <aidanhs@cantab.net>
* Charlie Birks <admin@daftgames.net>
* Ranger Harke <ranger.harke@autodesk.com> (copyright owned by Autodesk, Inc.)
* Tobias Vrinssen <tobias@vrinssen.de>
* Patrick R. Martin <patrick.martin.r@gmail.com>
* Richard Quirk <richard.quirk@gmail.com>
* Marcos Scriven <marcos@scriven.org>
* Antoine Lambert <antoine.lambert33@gmail.com>
* Daniel Aquino <mr.danielaquino@gmail.com>
* Remi Papillie <remi.papillie@gmail.com>
* Fraser Adams <fraser.adams@blueyonder.co.uk>
* Michael Tirado <icetooth333@gmail.com>
* Ben Noordhuis <info@bnoordhuis.nl>
* Bob Roberts <bobroberts177@gmail.com>
* John Vilk <jvilk@cs.umass.edu>
* Daniel Baulig <dbaulig@fb.com> (copyright owned by Facebook, Inc.)
* Lu Wang <coolwanglu@gmail.com>
* Heidi Pan <heidi.pan@intel.com> (copyright owned by Intel)
* Vasilis Kalintiris <ehostunreach@gmail.com>
* Adam C. Clifton <adam@hulkamaniac.com>
* Volo Zyko <volo.zyko@gmail.com>
* Andre Weissflog <floooh@gmail.com>
* Alexandre Perrot <alexandre.perrot@gmail.com>
* Emerson José Silveira da Costa <emerson.costa@gmail.com>
* Jari Vetoniemi <mailroxas@gmail.com>
* Sindre Sorhus <sindresorhus@gmail.com>
* James S Urquhart <jamesu@gmail.com>
* Boris Gjenero <boris.gjenero@gmail.com>
* jonas echterhoff <jonas@unity3d.com>
* Sami Vaarala <sami.vaarala@iki.fi>
* Jack A. Arrington <jack@epicpineapple.com>
* Richard Janicek <r@janicek.co>
* Joel Croteau <jcroteau@gmail.com>
* Haneef Mubarak <haneef503@gmail.com>
* Nicolas Peri <nicox@shivaengine.com> (copyright owned by ShiVa Technologies, SAS)
* Bernhard Fey <e-male@web.de>
* Dave Nicponski <dave.nicponski@gmail.com>
* Jonathan Jarri <noxalus@gmail.com>
* Daniele Di Proietto <daniele.di.proietto@gmail.com>
* Dan Dascalescu <dNOSPAMdascalescu@gmail.com>
* Thomas Borsos <thomasborsos@gmail.com>
* Ori Avtalion <ori@avtalion.name>
* Guillaume Blanc <guillaumeblanc.sc@gmail.com>
* Usagi Ito <usagi@WonderRabbitProject.net>
* Camilo Polymeris <cpolymeris@gmail.com>
* Markus Henschel <markus.henschel@yager.de>
* Ophir Lojkine <ophir.lojkine@eleves.ec-nantes.fr>
* Ryan Sturgell <ryan.sturgell@gmail.com> (copyright owned by Google, Inc.)
* Jason Green <jason@transgaming.com> (copyright owned by TransGaming, Inc.)
* Ningxin Hu <ningxin.hu@intel.com> (copyright owned by Intel)
* Nicolas Guillemot <nlguillemot@gmail.com>
* Sathyanarayanan Gunasekaran <gsathya.ceg@gmail.com> (copyright owned by Mozilla Foundation)
* Nikolay Vorobyov <nik.vorobyov@gmail.com>
* Jonas Platte <mail@jonasplatte.de>
* Sebastien Ronsse <sronsse@gmail.com>
* Glenn R. Wichman <gwichman@zynga.com>
* Hamish Willee <hamishwillee@gmail.com> (copyright owned by Mozilla Foundation)
* Sylvain Chevalier <sylvain.chevalier@gmail.com>
* Nathan Ross <nross.se@gmail.com>
* Zachary Pomerantz <zmp@umich.edu>
* Boris Tsarev <boristsarev@gmail.com>
* Mark Logan <mark@artillery.com> (copyright owned by Artillery Games, Inc.)
* Коренберг Марк <socketpair@gmail.com>
* Gauthier Billot <gogoprog@gmail.com>
* Árpád Goretity <h2co3@h2co3.org>
* Nicholas Wilson <nicholas@nicholaswilson.me.uk>
* Aaron Mandle <aaronmandle@gmail.com>
* Bailey Hayes <Bailey.Hayes@sas.com> (copyright owned by SAS Institute Inc.)
* Paul Holland <pholland@adobe.com>
* James Long <longster@gmail.com>
* David Anderson <danderson@mozilla.com> (copyright owned by Mozilla Foundation)
* Eric Rannaud <e@nanocritical.com> (copyright owned by Nanocritical Corp.)
* William Furr <wfurr@google.com> (copyright owned by Google, Inc.)
* Dan Glastonbury <dglastonbury@mozilla.com> (copyright owned by Mozilla Foundation)
* Warren Seine <warren.seine@aerys.in> (copyright owned by Aerys SAS)
* Petr Babicka <babcca@gmail.com>
* Akira Takahashi <faithandbrave@gmail.com>
* Victor Costan <costan@gmail.com>
* Pepijn Van Eeckhoudt <pepijn.vaneeckhoudt@luciad.com> (copyright owned by Luciad NV)
* Stevie Trujillo <stevie.trujillo@gmail.com>
* Edward Rudd <urkle@outoforder.cc>
* Rene Eichhorn <rene.eichhorn1@gmail.com>
* Nick Desaulniers <nick@mozilla.com> (copyright owned by Mozilla Foundation)
* Luke Wagner <luke@mozilla.com> (copyright owned by Mozilla Foundation)
* Matt McCormick <matt.mccormick@kitware.com>
* Thaddée Tyl <thaddee.tyl@gmail.com>
* Philipp Wiesemann <philipp.wiesemann@arcor.de>
* Jan Jongboom <janjongboom@gmail.com> (copyright owned by Telenor Digital AS)
* Tiago Quelhas <tiagoq@gmail.com>
* Reinier de Blois <rddeblois@gmail.com>
* Yuichi Nishiwaki <yuichi.nishiwaki@gmail.com>
* Jérôme Bernard <jerome.bernard@ercom.fr> (copyright owned by Ercom)
* Chanhwi Choi <ccwpc@hanmail.net>
* Fábio Santos <fabiosantosart@gmail.com>
* Thibaut Despoulain <thibaut@artillery.com> (copyright owned by Artillery Games, Inc.)
* Wei Tjong Yao <weitjong@gmail.com>
* Tim Guan-tin Chien <timdream@gmail.com>
* Krzysztof Jakubowski <nadult@fastmail.fm>
* Vladimír Vondruš <mosra@centrum.cz>
* Brion Vibber <brion@pobox.com>
* Philip Lafleur <sendsbeak@gmail.com>
* Javier Meseguer de Paz <j.meseguer@gmail.com>
* Michael A. Balazs <michael.balazs@gmail.com>
* Andreas Blixt <me@blixt.nyc>
* Haofeng Zhang <h.z@duke.edu>
* Cody Welsh <codyw@protonmail.com>
* Hoong Ern Ng <hoongern@gmail.com>
* Kagami Hiiragi <kagami@genshiken.org>
* Jan Bölsche <jan@lagomorph.de>
* Sebastian Matthes <sebastianmatthes@outlook.com> (copyright owned by Volkswagen AG)
* Robert Goulet <robert.goulet@autodesk.com> (copyright owned by Autodesk, Inc.)
* Juha Järvi <befunge@gmail.com>
* Louis Lagrange <lagrange.louis@gmail.com>
* Ying-Ruei Liang <thumbd03803@gmail.com>
* Stuart Geipel <lapimlu@gmail.com>
* Yeonjun Lim <yjroot@gmail.com>
* Andrew Karpushin <reven86@gmail.com>
* Felix Zimmermann <fzimmermann89@gmail.com>
* Sven-Hendrik Haase <svenstaro@gmail.com>
* Simon Sandström <simon@nikanor.nu>
* Khaled Sami <k.sami.mohammed@gmail.com>
* Omar El-Mohandes <omar.elmohandes90@gmail.com>
* Florian Rival <florian.rival@gmail.com>
* Mark Achée <mark@achee.com>
* Piotr Paczkowski <kontakt@trzeci.eu>
* Braden MacDonald <braden@bradenmacdonald.com>
* Kevin Cheung <kevin.cheung@autodesk.com> (copyright owned by Autodesk, Inc.)
* Josh Peterson <petersonjm1@gmail.com>
* eska <eska@eska.me>
* Nate Burr <nate.oo@gmail.com>
* Paul "TBBle" Hampson <Paul.Hampson@Pobox.com>
* Andreas Plesch <andreasplesch@gmail.com>
* Brian Armstrong <brian.armstrong.ece+github@gmail.com>
* Vincenzo Chianese <vincenz.chianese@icloud.com>
* Noam T.Cohen <noam@ecb.co.il>
* Nick Shin <nick.shin@gmail.com>
* Gregg Tavares <github@greggman.com>
* Tanner Rogalsky <tanner@tannerrogalsky.com>
* Richard Cook <rcook@tableau.com> (copyright owned by Tableau Software, Inc.)
* Arnab Choudhury <achoudhury@tableau.com> (copyright owned by Tableau Software, Inc.)
* Charles Vaughn <cvaughn@tableau.com> (copyright owned by Tableau Software, Inc.)
* Pierre Krieger <pierre.krieger1708@gmail.com>
* Jakob Stoklund Olesen <stoklund@2pi.dk>
* Jérémy Anger <angerj.dev@gmail.com>
* Derek Schuff <dschuff@chromium.org> (copyright owned by Google, Inc.)
* Ashley Sommer <flubba86@gmail.com>
* Dave Fletcher <graveyhead@gmail.com>
* Lars-Magnus Skog <ralphtheninja@riseup.net>
* Pieter Vantorre <pietervantorre@gmail.com>
* Maher Sallam <maher@sallam.me>
* Andrey Burov <burik666@gmail.com>
* Holland Schutte <hgschutte1@gmail.com>
* Kerby Geffrard <kerby.geffrard@gmail.com>
* cynecx <me@cynecx.net>
* Chris Gibson <cgibson@mrvoxel.com>
* Harald Reingruber <code*at*h-reingruber.at>
* Aiden Koss <madd0131@umn.edu>
* Dustin VanLerberghe <good_ol_dv@hotmail.com>
* Philip Bielby <pmb45-github@srcf.ucam.org> (copyright owned by Jagex Ltd.)
* Régis Fénéon <regis.feneon@gmail.com>
* Dominic Chen <d.c.ddcc@gmail.com> (copyright owned by Google, Inc.)
* Junji Hashimoto <junji.hashimoto@gmail.com>
* Heejin Ahn <aheejin@gmail.com> (copyright owned by Google, Inc.)
* Andras Kucsma <andras.kucsma@gmail.com>
* Mateusz Borycki <mateuszborycki@gmail.com>
* Franklin Ta <fta2012@gmail.com>
* Jacob Gravelle <jgravelle@google.com> (copyright owned by Google, Inc.)
* Kagami Sascha Rosylight <saschanaz@outlook.com>
* Benny Jacobs <benny@gmx.it>
* Ray Brown <code@liquibits.com>
* Christopher Serr <christopher.serr@gmail.com>
* Aaron Ruß <aaron.russ@dfki.de> (copyright owned by DFKI GmbH)
* Vilibald Wanča <vilibald@wvi.cz>
* Alex Hixon <alex@alexhixon.com>
* Vladimir Davidovich <thy.ringo@gmail.com>
* Yuriy Levchenko <irov13@mail.ru>
* Dmitry Tolmachov <dmitolm@gmail.com>
* Dylan McKay <me@dylanmckay.io>
* Christophe Gragnic <cgragnic@netc.fr>
* Murphy McCauley <murphy.mccauley@gmail.com>
* Anatoly Trosinenko <anatoly.trosinenko@gmail.com>
* Brad Grantham <grantham@plunk.org>
* Sam Clegg <sbc@chromium.org> (copyright owned by Google, Inc.)
* Joshua Lind <joshualind007@hotmail.com>
* Hiroaki GOTO as "GORRY" <gorry@hauN.org>
* Mikhail Kremnyov <mkremnyov@gmail.com> (copyright owned by XCDS International)
* Tasuku SUENAGA a.k.a. gunyarakun <tasuku-s-github@titech.ac>
* Vitorio Miguel Prieto Cilia <vdrbandeiras@gmail.com>
* Evan Wallace <evan.exe@gmail.com>
* Henning Pohl <henning@still-hidden.de>
* Tim Neumann <mail@timnn.me>
* Ondrej Stava <ondrej.stava@gmail.com> (copyright owned by Google, Inc.)
* Jakub Jirutka <jakub@jirutka.cz>
* Loo Rong Jie <loorongjie@gmail.com>
* Jean-François Geyelin <jfgeyelin@gmail.com>
* Matthew Collins <thethinkofdeath@gmail.com>
* Satoshi N. M <snmatsutake@yahoo.co.jp>
* Ryan Speets <ryan@speets.ca>
* Fumiya Chiba <fumiya.chiba@nifty.com>
* Ryan C. Gordon <icculus@icculus.org>
* Inseok Lee <dlunch@gmail.com>
* Yair Levinson (copyright owned by Autodesk, Inc.)
* Matjaž Drolc <mdrolc@gmail.com>
* James Swift <james@3dengineer.com> (copyright owned by PSPDFKit GmbH)
* Ryan Lester <ryan@cyph.com> (copyright owned by Cyph, Inc.)
* Nikolay Zapolnov <zapolnov@gmail.com>
* Nazar Mokrynskyi <nazar@mokrynskyi.com>
* Yury Delendik <ydelendik@mozilla.com> (copyright owned by Mozilla Foundation)
* Kenneth Perry <thothonegan@gmail.com>
* Jim Mussared <jim.mussared@gmail.com>
* Dirk Vanden Boer <dirk.vdb@gmail.com>
* Mitchell Foley <mitchfoley@google.com> (copyright owned by Google, Inc.)
* Oleksandr Chekhovskyi <oleksandr.chekhovskyi@gmail.com>
* Michael Siebert <michael.siebert2k@gmail.com>
* Jonathan Hale <squareys@googlemail.com>
* Etienne Brateau <etienne.brateau@gmail.com>
* Zhiming Wang <zmwangx@gmail.com>
* Jameson Ernst <jameson@jpernst.com>
* Yoan Lecoq <yoanlecoq.io@gmail.com>
* Jiajie Hu <jiajie.hu@intel.com> (copyright owned by Intel Corporation)
* Kamil Klimek <naresh@tlen.pl>
* José Carlos Pujol <josecpujol(at)gmail.com>
* Dannii Willis <curiousdannii@gmail.com>
* Erik Dubbelboer <erik@dubbelboer.com>
* Sergey Tsatsulin <tsatsulin@gmail.com>
* varkor <github@varkor.com>
* Stuart Knightley <website@stuartk.com>
* Amadeus Guo <gliheng@foxmail.com>
* Nathan Froyd <froydnj@gmail.com> (copyright owned by Mozilla Foundation)
* Daniel Wirtz <dcode@dcode.io>
* Kibeom Kim <kk1674@nyu.edu>
* Marcel Klammer <m.klammer@tastenkunst.com>
* Axel Forsman <axelsfor@gmail.com>
* Ebrahim Byagowi <ebrahim@gnu.org>
* Thorsten Möller <thorsten.moeller@sbi.ch>
* Michael Droettboom <mdroettboom@mozilla.com>
* Nicolas Bouquet <hgy01@hieroglyphe.net>
* Miguel Saldivar <miguel.saldivar22@hotmail.com>
* Gert Van Hoey <gert.vanhoey@gmail.com>
* Valtteri Heikkilä <rnd@nic.fi>
* Daniel McNab <daniel.mcnab6+emcc(at)gmail.com>
* Tyler Limkemann <tslimkemann42 gmail.com>
* Ben Smith <binji@google.com> (copyright owned by Google, Inc.)
* Sylvain Beucler <beuc@beuc.net>
* Patrik Weiskircher <patrik@weiskircher.name>
* Tobias Widlund <widlundtobias(at)gmail.com>
* Rob Fors <mail@robfors.com>
* Mike Frysinger <vapier@chromium.org> (copyright owned by Google, Inc.)
* Sébasiten Crozet <developer@crozet.re>
* Andrey Nagikh <andrey@nagih.ru>
* Dzmitry Malyshau <dmalyshau@mozilla.com> (copyright owned by Mozilla Foundation)
* Bjorn Swenson <tie.372@gmail.com>
* Ryhor Spivak <grisha@rusteddreams.net>
* Jan Schär <jscissr@gmail.com>
* Ryhor Spivak <grisha@rusteddreams.net>
* Alexander Bich <quyse0@gmail.com>
* Ashleigh Thomas <ashleighbcthomas@gmail.com>
* Veniamin Petrenko <bjpbjpbjp10@gmail.com>
* Ian Henderson <ian@ianhenderson.org>
* Siim Kallas <siimkallas@gmail.com>
* Carl Woffenden <cwoffenden@gmail.com> (copyright owned by Numfum GmbH)
* Patrick Berger <patrick.berger@xmail.net> (copyright owned by Compusoft Group)
* Alexander Frank Lehmann <alexander.frank.lehmann@compusoftgroup.com> (copyright owned by Compusoft Group)
* Tommy Nguyen <tn0502@gmail.com>
* Thomas Schander <info@thomasschander.com> (copyright owned by Enscape GmbH)
* Benjamin S. Rodgers <acdimalev@gmail.com>
* Paul Shapiro <paul@mymonero.com>
* Elmo Todurov <elmo.todurov@eesti.ee>
* Zoltán Žarkov <zeko@freecivweb.org>
* Roman Yurchak <rth.yurchak@pm.me>
* Hampton Maxwell <me@hamptonmaxwell.com>
* Eric Fiselier <ericwf@google.com> (copyright owned by Google, Inc.)
* Sirapop Wongstapornpat <sirapop.wongstapornpat@student.oulu.fi>
* Matt Kane <m@mk.gg>
* Altan Özlü <altanozlu7@gmail.com>
* Mary S <ipadlover8322@gmail.com>
* Martin Birks <mbirks@gmail.com>
* Kirill Smelkov <kirr@nexedi.com> (copyright owned by Nexedi)
* Lutz Hören <laitch383@gmail.com>
* Pedro K Custodio <git@pedrokcustodio.com>
* Nicolas Allemand <contact@nicolasallemand.com>
* Gabriel Cuvillier <contact@gabrielcuvillier.pro>
* Thomas Lively <tlively@google.com> (copyright owned by Google, Inc.)
* Brandon Surmanski <b.surmanski@gmail.com>
* Rian Hunter <rian@alum.mit.edu>
* Kai Ninomiya <kainino@chromium.org> (copyright owned by Google, Inc.)
* Mickaël Schoentgen <contact@tiger-222.fr>
* Renaud Leroy <capitnflam@gmail.com>
* Florian Stellbrink <florian@stellbr.ink>
* Shane Peelar <lookatyouhacker@gmail.com>
* Alessandro Pignotti <alessandro@leaningtech.com>
* Zheng Tao Lee <zhengtao.lee@autodesk.com> (copyright owned by Autodesk, Inc.)
* Martina Kraus <kraus.martina.m@googlemail.com>
* Jacob Adelgren <jake@eevo.com>
* Ingvar Stepanyan <me@rreverser.com>
* Ben Trapani <ben.trapani1995@gmail.com> (copyright owned by Microsoft, Inc.)
* Tim Lander <tim57282＠hotmail.com>
* Jacob Greenfield <jacob@jacobgreenfield.me>
* Joseph Kogut <joseph.kogut@gmail.com>
* Yi Zhang <milizhang@gmail.com>
* Marc Abramowitz <msabramo@gmail.com>
* Daniel Ruf <daniel@daniel-ruf.de>
* Timothy Trindle <titrindl@microsoft.com> (copyright owned by Microsoft, Inc.)
* Matthew Andres Moreno <m.more500@gmail.com>
* Eric Mandel <eric@cfa.harvard.edu>
* Anthony Catel <paraboul@gmail.com>
* Simon Cooper <simon.d.cooper@hotmail.co.uk>
* Amir Rasouli <arasouli91@gmail.com>
* Nico Weber <thakis@chromium.org>
* Bas Doorn <code@keyn.app> (copyright owned by Keyn B.V.)
* Adam Bujalski <a.bujalski@samsung.com> (copyright owned by Samsung Electronics)
* Guanzhong Chen <gzchen@google.com> (copyright owned by Google, Inc.)
* Denis Serebro <densilver3000@gmail.com>
* Lucas Ramage <ramage.lucas@protonmail.com>
* Andy Wingo <wingo@igalia.com> (copyright owned by Igalia)
* Philipp Gloor <philipp.gloor@pdf-tools.com> (copyright owned by PDF Tools AG)
* Jasmine Minter <jasmine@minteronline.com> (copyright owned by Clipchamp Pty Ltd.)
* Ferris Kwaijtaal <ferrispc@hotmail.com>
* Konstantin Podsvirov <konstantin@podsvirov.pro>
* Eduardo Bart <edub4rt@gmail.com>
* Zoltan Varga <vargaz@gmail.com> (copyright owned by Microsoft, Inc.)
* Fernando Serboncini <fserb@google.com>
* Christian Clauss <cclauss@me.com> (copyright owned by IBM)
* Henry Kleynhans <hkleynhans@bloomberg.net> (copyright owned by Bloomberg L.P.)
* FUJI Goro <g.psy.va@gmail.com>
* Egor Suvorov <esuvorov@think-cell.com> (copyright owned by think-cell Software GmbH)
* James Kuszmaul <jabukuszmaul@gmail.com>
* Wei Mingzhi <whistler_wmz@users.sourceforge.net>
* Sergey karchevsky <sergey.ext@gmail.com>
* Ajay Patel <patel.ajay285@gmail.com>
* Adrien Devresse <adev@adev.name>
* Petr Penzin <petr.penzin@intel.com> (copyright owned by Intel Corporation)
* Tayeb Al Karim <tay@google.com> (copyright owned by Google, Inc.)
* Andrei Alexeyev <akari@taisei-project.org>
* Cesar Guirao Robles <cesar@no2.es>
* Ricky Claven <ricksterhd123@gmail.com>
* Mehdi Sabwat <mehdisabwat@gmail.com>
* MinganMuon <mingan-muon@outlook.com>
* Jonathan Feinberg <feinberg@google.com>
* Osman Turan <osman@osmanturan.com>
* Jaikanth J <jaikanthjay46@gmail.com>
* Gernot Lassnig <gernot.lassnig@gmail.com>
* Christian Boos <cboos@bct-technology.com>
* Erik Scholz <greenNO@SPAMg-s.xyz>
* Michael de Lang <kingoipo@gmail.com>
* Gergely Nagy <ngg@tresorit.com>
* Jan Habermann <jan@habermann.io>
* John Granström <granstrom.john@gmail.com>
* Clemens Backes <clemensb@google.com> (copyright owned by Google, Inc.)
* Tibor Klajnscek <tiborkl@numfum.com>
* Benjamin Golinvaux <benjamin@golinvaux.com>
* Peter Salomonsen <pjsalomonsen@gmail.com>
* Niklas Fiekas <niklas.fiekas@backscattering.de>
* Martín Lucas Golini <spartanj@gmail.com>
* Bumsik Kim <k.bumsik@gmail.com>
* Corentin Wallez <cwallez@chromium.org> (copyright owned by Google, Inc.)
* Austin Eng <enga@chromium.org> (copyright owned by Google, Inc.)
* Hugo Amiard <hugo.amiard@laposte.net>
* Diego Casorran <dcasorran@gmail.com>
* sssooonnnggg <sssooonnnggg111@gmail.com>
* Guillaume Racicot <gufideg@gmail.com>
* SK Min <oranke@gmail.com>
* Fabio Alessandrelli <fabio.alessandrelli@gmail.com>
* Kirill Gavrilov <kirill@sview.ru>
* Karl Semich <0xloem@gmail.com>
* Louis DeScioli <descioli@google.com> (copyright owned by Google, LLC)
* Kleis Auke Wolthuizen <info@kleisauke.nl>
* Michael Potthoff <michael@potthoff.eu>
* Abigail Bunyan <abigail@bold.claims> (copyright owned by Microsoft Corporation)
* David García Paredes <davidgparedes@gmail.com>
* Dan Field <dfield@gmail.com> (copyright owned by Google, Inc.)
* Mike Swierczek <mike@swierczek.io>
* Vasily <just.one.man@yandex.ru>
* Jānis Rūcis <parasti@gmail.com>
* rssqian <rssqian@gmail.com>
* Shachar Langbeheim <nihohit@gmail.com>
* Laurin Agostini <thevolut@gmail.com>
* David Carlier <devnexen@gmail.com>
* Paul Du <du.paul136@gmail.com> (copyright owned by ARSKAN)
* Piotr Doan <doanpiotr@gmail.com>
* Stuart Schechter <stuart.schechter@gmail.com>
* Brett Paterson <brett@fmod.com>
* Robert Aboukhalil <robert.aboukhalil@gmail.com>
* Jonathan Poelen <jonathan.poelen@gmail.com>
* Ashley Hauck <github@khyperia.com>
* Junyue Cao <junyuecao@gmail.com>
* Elías Serrano <feserr3@gmail.com>
* Philip Pfaffe <pfaffe@google.com> (copyright owned by Google, LLC)
* Troy Tae <tjy970721@gmail.com>
* Sky Wang <sky-wang@qq.com>
* popomen <nz_nuaa@163.com>
* Artyom Lebedev <vagran.ast@gmail.com>
* Sebastián Gurin (cancerberoSgx) <sebastigurin@gmail.com>
* Benedikt Meurer <bmeurer@google.com> (copyright owned by Google, LLC)
* Jiulong Wang <jiulongw@gmail.com>
* pudinha <rogi@skylittlesystem.org>
* Nicholas Phillips <nwp2@illinois.edu>
* Colin Guyon <colin.guyon@insimo.fr> (copyright owned by InSimo, SAS)
* Mathias Westerdahl <mwesterdahl76@gmail.com>
* Philip Rideout <prideout@google.com> (copyright owned by Google, LLC)
* Shrek Shao (shrekshao@google.com) (copyright owned by Google, LLC)
* Arran Ireland <ion92@protonmail.com>
* Jia Yuan Lo <jylo06g@gmail.com>
* Philip Lassen <philiplassen@gmail.com>
* Antoine du Hamel <duhamelantoine1995@gmail.com>
* Alexander Köplinger <alex.koeplinger@outlook.com> (copyright owned by Microsoft, Inc.)
* Kenneth Pouncey <kepounce@microsoft.com> (copyright owned by Microsoft, Inc.)
* Mitchell Hwang <mihw@microsoft.com> (copyright owned by Microsoft, Inc.)
* Sean Maher <seanptmaher@gmail.com> (copyright owned by Google, LLC)
* Paul Peny <pmpp.pub@gmail.com>
* Prashanth Nethi <prashant@adobe.com>
* Max Weisel <max@maxweisel.com>
* Georg Rottensteiner <georg@georg-rottensteiner.de>
* Tristan Griffin <tristan.griffin@hcl.com> (Copyright owned by HCL)
* Julien Jorge <julien.jorge@gmx.fr>
* Benjamin Lee <bnllee@ucdavis.edu>
* Attila Oláh <atl@google.com> (copyright owned by Google, LLC)
* Marat Dukhan <maratek@google.com> (copyright owned by Google, LLC)
* Raphael Siegel <siegel.raphael@gmail.com>
* Stephan Reiter <reste@google.com> (copyright owned by Google, LLC)
* kamenokonyokonyoko <kamenokonokotan@gmail.com>
* Lectem <lectem@gmail.com>
* Henrik Algestam <henrik@algestam.se>
* Rocco Musolino <roccomusolino92@gmail.com>
* Pawel Czarnecki <pawel@8thwall.com> (copyright owned by 8th Wall, Inc.)
* Dhairya Bahl < dhairyabahl5@gmail.com >
* Sam Gao <gaoshan274@gmail.com>
* Sebastian Mayr <me@sam.st>
* Vladimir Gamalyan <vladimir.gamalyan@gmail.com>
* Jean-Sébastien Nadeau <mundusnine@gmail.com> (copyright owned by Foundry Interactive Inc.)
* Wouter van Oortmerssen <wvo@google.com> (copyright owned by Google, LLC)
* Alexey Sokolov <sokolov@google.com> (copyright owned by Google, LLC)
* Lukas Rieger <rieger@progress-psd.com>
* Ivan Romanovski <ivan.romanovski@gmail.com>
* Max Brunsfeld <maxbrunsfeld@gmail.com>
* Basil Fierz <basil.fierz@hotmail.com>
* Rod Hyde <rod@badlydrawngames.com>
* Aleksey Kliger <aleksey@lambdageek.org> (copyright owned by Microsoft, Inc.)
* Nicolas Ollinger <nopid@free.fr>
* Michael R. Crusoe <crusoe@debian.org>
* Dexter Chua <dec41@srcf.net>
* Thomas Ballinger <thomasballinger@gmail.com>
* Mehdi Sadeghi <mehdi@mehdix.org>
* Amin Yahyaabadi <aminyahyaabadi74@gmail.com>
* Adam Leskis <leskis@gmail.com>
* Raffaele Pertile <raffarti@zoho.com>
* Patric Stout <github@truebrain.nl>
* Jinoh Kang <jinoh.kang.kr@gmail.com>
* Jorge Prendes <jorge.prendes@gmail.com>
* Alexey Shamrin <shamrin@gmail.com>
* Wirtos <wirtos.new@gmail.com>
* Ben den Hollander <bdenhollander@dynascape.com> (copyright owned by DynaScape Software Inc.)
* Akul Penugonda <akulvp@gmail.com>
* Jan Wolff <contact@jancc.de>
* Pawel Czarnecki <pawel@8thwall.com> (copyright owned by 8th Wall, Inc.)
* Camil Staps <info@camilstaps.nl>
* Michael Kircher <michael.kircher.github@gmail.com>
* Sharad Saxena <sharad.saxena@autodesk.com> (copyright owned by Autodesk, Inc.)
* Vasili Skurydzin <vasili.skurydzin@ibm.com>
* Jakub Nowakowski <jn925+emcc@o2.pl>
* Michael Taylor <mitaylor@adobe.com>
* Andrew Brown <andrew.brown@intel.com> (copyright owned by Intel Corporation)
* Benjamin Puzycki <bpuzycki@umich.edu>
* Marco Buono <marcobuono@invisionapp.com> (copyright owned by InVisionApp, Inc.)
* Philip Gossweiler <philip.gossweiler@outlook.com>
* Rafael Brune <mail@rbrune.de>
* Aleksi Sapon <aleksi.sapon@faro.com> (copyright owned by FARO Technologies, Inc.)
* Radek Doulik <radek.doulik@gmail.com> (copyright owned by Microsoft, Inc.)
* Érico Porto <ericoporto2008@gmail.com>
* Albert Vaca Cintora <albertvaka@gmail.com>
* Zhi An Ng <zhin@google.com> (copyright owned by Google, Inc.)
* Ian Jackson <ijackson@chiark.greenend.org.uk>
* Brian Gontowski <brian@gontowski.com>
* Bobbie Chen <bobbie.chen75@gmail.com>
* Nicholas Hollander <nhollander98@gmail.com>
* Camillo Lugaresi <camillol@google.com> (copyright owned by Google LLC)
* Chris Craig <emscripten@goldwave.com>
* Le Yao <le.yao@intel.com> (copyright owned by Intel Corporation)
* José Cadete <crudelios@gmail.com>
* Cynthia K. Rey <cynthia@cynthia.dev>
* Andrew Shaitorov <andrew.shaitorov@gmail.com>
* on-keyday <rokenboo47803@gmail.com>
* Matthew Balch <matt5sean3@gmail.com>
* James Price <jrprice@google.com> (copyright owned by Google, Inc.)
* Nathan Rugg <nmrugg@gmail.com> (copyright owned by Chess.com, LLC)
* Alexander O'Mara <me@alexomara.com>
* Kamaron Peterson <kamaron.peterson@gmail.com>
* Márton Marczell <mmarczell.graphisoft@gmail.com> (copyright owned by GRAPHISOFT SE)
* Alexander Vestin <alex.vestin@gmail.com>
* Xiaobing Yang <yangxiaobing@jwzg.com>
* Alexandra Cherdantseva <neluhus.vagus@gmail.com>
* Michael Schmuki <michael@schmuki.io>
* Skye Gibney <skyejgibney@gmail.com>
* Piotr Wierciński <laminowany@gmail.com>
* 郑苏波 (Super Zheng) <superzheng@tencent.com>
* James Hu <jameshu2022@gmail.com>
* Jerry Zhuang <jerry.zhuang@jwzg.com>
* Taisei Kon <kinsei0916@gmail.com>
* YAMAMOTO Takashi <yamamoto@midokura.com>
* Artur Gatin <agatin@teladochealth.com> (copyright owned by Teladoc Health, Inc.)
* Christian Lloyd <clloyd@teladochealth.com> (copyright owned by Teladoc Health, Inc.)
* Sean Morris <sean@seanmorr.is>
* Mitchell Wills <mwills@google.com> (copyright owned by Google, Inc.)
* Han Jiang <jhcarl0814@gmail.com>
* Abdelrahman Teima <abdelrahmanteima@gmail.com>
* Jaap Aarts <jaap.aarts1@gmail.com>
* Dimokritos Kolitsos <dkolitsos@protonmail.com>

Source(s): LICENSE

Emscripten is available under 2 licenses, the MIT license and the
University of Illinois/NCSA Open Source License.

Both are permissive open source licenses, with little if any
practical difference between them.

The reason for offering both is that (1) the MIT license is
well-known, while (2) the University of Illinois/NCSA Open Source
License allows Emscripten's code to be integrated upstream into
LLVM, which uses that license, should the opportunity arise.

The full text of both licenses follows.

==============================================================================

Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

==============================================================================

Copyright (c) 2010-2014 Emscripten authors, see AUTHORS file.
All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a
copy of this software and associated documentation files (the
"Software"), to deal with the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

    Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimers.

    Redistributions in binary form must reproduce the above
    copyright notice, this list of conditions and the following disclaimers
    in the documentation and/or other materials provided with the
    distribution.

    Neither the names of Mozilla,
    nor the names of its contributors may be used to endorse
    or promote products derived from this Software without specific prior
    written permission.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE CONTRIBUTORS OR COPYRIGHT HOLDERS BE LIABLE FOR
ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS WITH THE SOFTWARE.

==============================================================================

This program uses portions of Node.js source code located in src/library_path.js,
in accordance with the terms of the MIT license. Node's license follows:

    """
        Copyright Joyent, Inc. and other Node contributors. All rights reserved.
        Permission is hereby granted, free of charge, to any person obtaining a copy
        of this software and associated documentation files (the "Software"), to
        deal in the Software without restriction, including without limitation the
        rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
        sell copies of the Software, and to permit persons to whom the Software is
        furnished to do so, subject to the following conditions:

        The above copyright notice and this permission notice shall be included in
        all copies or substantial portions of the Software.

        THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
        IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
        FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
        AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
        LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
        FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
        IN THE SOFTWARE.
    """

The musl libc project is bundled in this repo, and it has the MIT license, see
system/lib/libc/musl/COPYRIGHT

The third_party/ subdirectory contains code with other licenses. None of it is
used by default, but certain options use it (e.g., the optional closure compiler
flag will run closure compiler from third_party/).

Source(s): src/Fetch.js, src/lib/libfetch.js, src/lib/libproxyfs.js

/**
 * @license
 * Copyright 2016 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/IDBStore.js, src/cpuprofiler.js, src/lib/libbootstrap.js, src/lib/libidbstore.js, src/lib/liblz4.js, src/lib/libpthread_stub.js, src/lib/libsyscall.js, src/lib/libworkerfs.js, src/memoryprofiler.js, src/runtime_pthread.js, src/threadprofiler.js

/**
 * @license
 * Copyright 2015 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/closure-externs/closure-externs.js

/**
 * Copyright 2014 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * This file contains definitions for things that we'd really rather the closure compiler *didn't* minify.
 * See http://code.google.com/p/closure-compiler/wiki/FAQ#How_do_I_write_an_externs_file
 * See also the discussion here: https://github.com/emscripten-core/emscripten/issues/1979
 *
 * The closure_compiler() method in tools/building.py refers to this file when calling closure.
 */

Source(s): src/deterministic.js, src/lib/libasync.js, src/lib/libglew.js, src/lib/libhtml5.js, src/lib/libhtml5_webgl.js, src/lib/libtrace.js

/**
 * @license
 * Copyright 2014 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/emrun_postjs.js

/**
 * @license
 * Copyright 2013 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 *
 * This file gets implicitly injected as a `--post-js` file when
 * emcc is run with `--emrun`
 */

Source(s): src/emrun_prejs.js

/**
 * @license
 * Copyright 2013 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 *
 * This file gets implicitly injected as a `--pre-js` file when
 * emcc is run with `--emrun`
 */

Source(s): src/gl-matrix.js

/*
 * Copyright (c) 2011 Brandon Jones
 *
 * This software is provided 'as-is', without any express or implied
 * warranty. In no event will the authors be held liable for any damages
 * arising from the use of this software.
 *
 * Permission is granted to anyone to use this software for any purpose,
 * including commercial applications, and to alter it and redistribute it
 * freely, subject to the following restrictions:
 *
 *    1. The origin of this software must not be misrepresented; you must not
 *    claim that you wrote the original software. If you use this software
 *    in a product, an acknowledgment in the product documentation would be
 *    appreciated but is not required.
 *
 *    2. Altered source versions must be plainly marked as such, and must not
 *    be misrepresented as being the original software.
 *
 *    3. This notice may not be removed or altered from any source
 *    distribution.
 */

Source(s): src/jsifier.mjs, src/lib/libcore.js, src/lib/libeventloop.js, src/lib/libexceptions.js, src/lib/libglemu.js, src/lib/libsdl.js, src/lib/libwebgl.js, src/lib/libwebgl2.js, src/parseTools_legacy.mjs, src/postamble.js, src/preamble.js, src/shell.js, src/shell_minimal.js, src/utility.mjs

/**
 * @license
 * Copyright 2010 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libaddfunction.js, src/lib/libbase64.js, src/lib/libexports.js, src/lib/libint53.js, src/lib/libstrings.js, src/runtime_debug.js

/**
 * @license
 * Copyright 2020 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libatomic.js, src/lib/libfetchfs.js, src/lib/libicasefs.js, src/lib/libjsfilefs.js, src/lib/libopfs.js, src/lib/libpromise.js, src/lib/libwasm_worker.js, src/runtime_exceptions.js

/**
 * @license
 * Copyright 2023 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libautodebug.js, src/lib/libccall.js, src/lib/libgetvalue.js, src/lib/libnodepath.js, src/lib/libwasmfs.js, src/lib/libwasmfs_fetch.js, src/lib/libwasmfs_jsimpl.js, src/lib/libwasmfs_node.js, src/lib/libwasmfs_opfs.js

/**
 * @license
 * Copyright 2022 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libbrowser.js, src/lib/libwget.js, src/modules.mjs

/**
 * @license
 * Copyright 2011 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libdylink.js

/**
 * @license
 * Copyright 2020 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 *
 * Dynamic library loading
 */

Source(s): src/lib/libegl.js, src/lib/libglut.js, src/lib/libxlib.js

/**
 * @license
 * Copyright 2012 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libembind.js, src/lib/libemval.js

// Copyright 2012 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

Source(s): src/lib/libembind_gen.js

// Copyright 2023 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.
#include "libembind_shared.js"

Source(s): src/lib/libembind_shared.js

// Copyright 2023 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

Source(s): src/lib/libepoll.js, src/lib/libsockfs_node.js, src/lib/libunwind.js

/**
 * @license
 * Copyright 2026 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libexceptions_stub.js, src/lib/libstack_trace.js, src/lib/libwasi.js, src/node_shell_read.js, src/postamble_minimal.js, src/preamble_minimal.js, src/runtime_asan.js, src/runtime_init_memory.js, src/runtime_safe_heap.js, src/runtime_stack_check.js, src/source_map_support.js, src/wasm2js.js, src/web_or_worker_shell_read.js

/**
 * @license
 * Copyright 2019 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libfs.js, src/lib/libglfw.js, src/lib/libidbfs.js, src/lib/libmemfs.js, src/lib/libnodefs.js, src/lib/libopenal.js, src/lib/libpath.js, src/lib/libsockfs.js, src/lib/libtty.js, src/lib/libuuid.js

/**
 * @license
 * Copyright 2013 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libfs.js

// Whether we are currently ignoring permissions. Useful when preparing the
    // filesystem and creating files inside read-only folders.
    // This is set to false during `preInit`, allowing you to modify the
    // filesystem freely up until that point (e.g. during `preRun`).

Source(s): src/lib/libfs.js

//
    // permissions
    //
    // convert O_* bitmask to a string for nodePermissions

Source(s): src/lib/libfs.js

// need delete permissions if we'll be overwriting.
      // need create permissions if new doesn't already exist.

Source(s): src/lib/libfs.js

// if we are going to change the parent, check write permissions

Source(s): src/lib/libfs.js

// node doesn't exist, try to create it
          // Ignore the permission bits here to ensure we can `open` this new
          // file below. We use chmod below to apply the permissions once the
          // file is open.

Source(s): src/lib/libfs.js

// check permissions, if this is not a file we just created now (it is ok to
      // create and write to a file with read-only permissions; it is read-only
      // for later use)

Source(s): src/lib/libfs.js

// User requests writing to file (prot & PROT_WRITE != 0).
      // Checking if we have permissions to write to the file unless
      // MAP_PRIVATE flag is set. According to POSIX spec it is possible
      // to write to file opened in read-only mode with MAP_PRIVATE flag,
      // as all modifications will be visible only in the memory of
      // the current process.

Source(s): src/lib/libfs_shared.js

/**
 * @license
 * Copyright 2032 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/liblegacy.js

/**
 * @license
 * Copyright 2010 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 *
 * Legacy library symbols that are no longer used by emscripten itself but
 * could have external users.
 *
 * Symbols in this file are not available in `-sSTRICT` mode.
 *
 * Any usage of symbols in this file will result in a `-Wdeprecated` warning.
 *
 * Symbol in this file should be removed after 'enough time' has passed such
 * that all external users have been able to transition away.
 */

Source(s): src/lib/libnodefs.js

// Windows does not report the 'x' permission bit, so propagate read
          // bits to execute bits.

Source(s): src/lib/libnodefs.js

// This maps the integer permission modes from http://linux.die.net/man/3/open
    // to node.js-specific file open permission strings at http://nodejs.org/api/fs.html#fs_fs_open_path_flags_mode_callback

Source(s): src/lib/libnodefs.js, src/lib/libnoderawfs.js

// Windows does not report the 'x' permission bit, so propagate read
        // bits to execute bits.

Source(s): src/lib/libnoderawfs.js, src/lib/libwebsocket.js

/**
 * @license
 * Copyright 2018 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libpipefs.js

/**
 * @license
 * Copyright 2017 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libpthread.js

/**
 * @license
 * Copyright 2015 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 *
 * Because only modern JS engines support SAB we can use modern JS language
 * features within this file (ES2020).
 */

Source(s): src/lib/libsyscall_shared.js

/**
 * @license
 * Copyright 2026 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 *
 * Syscalls that are shared between WasmFS and the old-FS.
 * Unlike `libsyscalls.js` this file is included under both filesystem backends.
 */

Source(s): src/lib/libtime.js, src/minimum_runtime_check.js, src/runtime_common.js

/**
 * @license
 * Copyright 2024 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/lib/libwasmfs_node.js

// Windows does not report the 'x' permission bit, so propagate read
      // bits to execute bits.

Source(s): src/modularize.js, src/pthread_esm_startup.mjs

/**
 * @license
 * Copyright 2025 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 */

Source(s): src/parseTools.mjs

/**
 * @license
 * Copyright 2010 The Emscripten Authors
 * SPDX-License-Identifier: MIT
 *
 * Helpers and tools for use at compile time by JavaScript library files.
 *
 * Tests live in test/other/test_parseTools.js.
 */

Source(s): src/settings.js

// Enables support for the ``NODERAWFS`` filesystem backend. This is a special
// backend as it replaces all normal filesystem access with direct Node.js
// operations, without the need to do ``FS.mount()``, and this backend only
// works with Node.js. The initial working directory will be same as
// process.cwd() instead of VFS root directory.  Because this mode directly uses
// Node.js to access the real local filesystem on your OS, the code will not
// necessarily be portable between OSes - it will be as portable as a Node.js
// program would be, which means that differences in how the underlying OS
// handles permissions and errors and so forth may be noticeable.
//
// Enabling this setting will also enable :ref:`NODE_HOST_ENV` by default.
// [link]

Source(s): src/settings.js

// Emits emscripten license info in the JS output.
// [link]

Source(s): src/settings_internal.js

//
// @license
// Copyright 2019 The Emscripten Authors
// SPDX-License-Identifier: MIT
//

Source(s): system/include/emscripten/atomic.h, system/include/emscripten/threading.h

/*
 * Copyright 2015 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/bind.h, system/include/emscripten/em_types.h, system/include/emscripten/emscripten.h, system/include/emscripten/exports.h, system/include/emscripten/val.h, system/include/emscripten/wget.h, system/include/emscripten/wire.h

/*
 * Copyright 2012 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/console.h, system/include/emscripten/eventloop.h, system/include/emscripten/proxying.h, system/include/emscripten/wasmfs.h, system/lib/libc/crt1_proxy_main.c, system/lib/libc/emscripten_console.c, system/lib/libc/emscripten_get_heap_size.c, system/lib/libc/kill.c, system/lib/libc/pthread_sigmask.c, system/lib/libc/raise.c, system/lib/libc/sigaction.c, system/lib/libc/sigtimedwait.c

/*
 * Copyright 2021 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/dom_pk_codes.h

/*
 * Copyright 2018 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * This file was automatically generated from script
 * tools/maint/create_dom_pk_codes.py. Edit that file to make changes here.
 * Then run:
 *
 *   tools/maint/create_dom_pk_codes.py
 *
 * in Emscripten root directory to regenerate this file.
 */

Source(s): system/include/emscripten/em_asm.h, system/include/emscripten/key_codes.h

/*
 * Copyright 2017 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/em_js.h, system/include/emscripten/websocket.h

/*
 * Copyright 2018 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/em_macros.h, system/include/emscripten/em_math.h, system/include/emscripten/heap.h, system/include/emscripten/html5_webgl.h, system/include/emscripten/stack.h, system/lib/libc/crt1_reactor.c, system/lib/libc/emscripten_scan_stack.c

/*
 * Copyright 2020 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/epoll.h, system/include/emscripten/syscalls.h, system/include/emscripten/threading_primitives.h, system/lib/libc/emscripten_yield_stub.c

/*
 * Copyright 2026 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/fetch.h

/*
 * Copyright 2016 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/fiber.h, system/lib/libc/crt1.c, system/lib/libc/emscripten_memmove.c, system/lib/libc/emscripten_memset.c, system/lib/libc/wasi-helpers.c, system/lib/standalone/__main_void.c, system/lib/standalone/standalone.c, system/lib/standalone/standalone_wasm_stdio.c

/*
 * Copyright 2019 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/html5.h, system/include/emscripten/trace.h

/*
 * Copyright 2014 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/promise.h, system/lib/libc/mktime.c

/*
 * Copyright 2023 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/include/emscripten/threading_legacy.h

/*
 * Copyright 2015 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Legacy proxying functions.  See proxying.h for the new proxying system.
 */

Source(s): system/include/emscripten/wasm_worker.h, system/include/emscripten/webaudio.h, system/lib/libc/atexit_dummy.c, system/lib/libc/emscripten_mmap.c, system/lib/libc/emscripten_time.c, system/lib/libc/musl/src/internal/progname.c, system/lib/libc/musl/src/internal/proxying_notification_state.h

/*
 * Copyright 2022 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

Source(s): system/lib/compiler-rt/LICENSE.TXT

==============================================================================
The LLVM Project is under the Apache License v2.0 with LLVM Exceptions:
==============================================================================

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

    TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

    1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

    2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

    3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

    4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

    5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

    6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

    7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

    8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

    9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

    END OF TERMS AND CONDITIONS

    APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

    Copyright [yyyy] [name of copyright owner]

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.


---- LLVM Exceptions to the Apache 2.0 License ----

As an exception, if, as a result of your compiling your source code, portions
of this Software are embedded into an Object form of such source code, you
may redistribute such embedded portions in such Object form without complying
with the conditions of Sections 4(a), 4(b) and 4(d) of the License.

In addition, if you combine or link compiled forms of this Software with
software that is licensed under the GPLv2 ("Combined Software") and if a
court of competent jurisdiction determines that the patent provision (Section
3), the indemnity provision (Section 9) or other Section of the License
conflicts with the conditions of the GPLv2, you may retroactively and
prospectively choose to deem waived or otherwise exclude such Section(s) of
the License, but only in their entirety and only with respect to the Combined
Software.

==============================================================================
Software from third parties included in the LLVM Project:
==============================================================================
The LLVM Project contains third party software which is under different license
terms. All such code will be identified clearly using at least one of two
mechanisms:
1) It will be in a separate directory tree with its own `LICENSE.txt` or
   `LICENSE` file at the top containing the specific license and restrictions
   which apply to that software, or
2) It will contain specific license and restriction terms at the top of every
   file.

==============================================================================
Legacy LLVM License (https://llvm.org/docs/DeveloperPolicy.html#legacy):
==============================================================================

The compiler_rt library is dual licensed under both the University of Illinois
"BSD-Like" license and the MIT license.  As a user of this code you may choose
to use it under either license.  As a contributor, you agree to allow your code
to be used under both.

Full text of the relevant licenses is included below.

==============================================================================

University of Illinois/NCSA
Open Source License

Copyright (c) 2009-2019 by the contributors listed in CREDITS.TXT

All rights reserved.

Developed by:

    LLVM Team

    University of Illinois at Urbana-Champaign

    http://llvm.org

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal with
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimers.

    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimers in the
      documentation and/or other materials provided with the distribution.

    * Neither the names of the LLVM Team, University of Illinois at
      Urbana-Champaign, nor the names of its contributors may be used to
      endorse or promote products derived from this Software without specific
      prior written permission.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
CONTRIBUTORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS WITH THE
SOFTWARE.

==============================================================================

Copyright (c) 2009-2015 by the contributors listed in CREDITS.TXT

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

Source(s): system/lib/compiler-rt/__c_longjmp.S

/*
 * Copyright 2025 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Define the `__c_longjmp` Wasm EH tag which is used to implement setjmp/longjmp
 * in LLVM.
 */

Source(s): system/lib/compiler-rt/emscripten_exception_builtins.c

/*
 * Copyright 2018 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Support functions for emscripten setjmp/longjmp and exception handling
 * support. References to the things below are generated in the LLVM backend.
 * See: https://llvm.org/doxygen/WebAssemblyLowerEmscriptenEHSjLj_8cpp.html
 */

Source(s): system/lib/compiler-rt/emscripten_setjmp.c

/*
* Copyright 2020 The Emscripten Authors.  All rights reserved.
* Emscripten is available under two separate licenses, the MIT license and the
* University of Illinois/NCSA Open Source License.  Both these licenses can be
* found in the LICENSE file.
*/

Source(s): system/lib/compiler-rt/include/profile/InstrProfData.inc

/*===-- InstrProfData.inc - instr profiling runtime structures -*- C++ -*-=== *\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/include/profile/MIBEntryDef.inc

/*===-- MemEntryDef.inc - MemProf profiling runtime macros -*- C++ -*-======== *\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/include/profile/MemProfData.inc

/*===-- MemProfData.inc - MemProf profiling runtime structures -*- C++ -*-=== *\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/include/profile/instr_prof_interface.h

/*===---- instr_prof_interface.h - Instrumentation PGO User Program API ----===
 *
 * Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
 * See https://llvm.org/LICENSE.txt for license information.
 * SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
 *
 *===-----------------------------------------------------------------------===
 *
 * This header provides a public interface for fine-grained control of counter
 * reset and profile dumping. These interface functions can be directly called
 * in user programs.
 *
\*===---------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/include/sanitizer/allocator_interface.h

//===-- allocator_interface.h ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Public interface header for allocator used in sanitizers (ASan/TSan/MSan).
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_INTERFACE_H
#define SANITIZER_ALLOCATOR_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/asan_interface.h

//===-- sanitizer/asan_interface.h ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer (ASan).
//
// Public interface header.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ASAN_INTERFACE_H
#define SANITIZER_ASAN_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/asan_interface.h

#ifdef ASAN_DEFINE_REGION_MACROS
/// Marks a memory region as unaddressable.
///
/// \note Macro provided for convenience; defined as a no-op if ASan is not
/// enabled.
///
/// \param addr Start of memory region.
/// \param size Size of memory region.
#define ASAN_POISON_MEMORY_REGION(addr, size)                                  \

Source(s): system/lib/compiler-rt/include/sanitizer/asan_interface.h

/// Marks a memory region as addressable.
///
/// \note Macro provided for convenience; defined as a no-op if ASan is not
/// enabled.
///
/// \param addr Start of memory region.
/// \param size Size of memory region.
#define ASAN_UNPOISON_MEMORY_REGION(addr, size)                                \

Source(s): system/lib/compiler-rt/include/sanitizer/common_interface_defs.h

//===-- sanitizer/common_interface_defs.h -----------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common part of the public sanitizer interface.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/include/sanitizer/coverage_interface.h

//===-- sanitizer/coverage_interface.h --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Public interface for sanitizer coverage.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/include/sanitizer/dfsan_interface.h

//===-- dfsan_interface.h -------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of DataFlowSanitizer.
//
// Public interface header.
//===----------------------------------------------------------------------===//
#ifndef DFSAN_INTERFACE_H
#define DFSAN_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/hwasan_interface.h

//===-- sanitizer/hwasan_interface.h ----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of HWAddressSanitizer.
//
// Public interface header.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_HWASAN_INTERFACE_H
#define SANITIZER_HWASAN_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/linux_syscall_hooks.h

//===-- linux_syscall_hooks.h ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of public sanitizer interface.
//
// System call handlers.
//
// Interface methods declared in this header implement pre- and post- syscall
// actions for the active sanitizer.
// Usage:
//   __sanitizer_syscall_pre_getfoo(...args...);
//   long res = syscall(__NR_getfoo, ...args...);
//   __sanitizer_syscall_post_getfoo(res, ...args...);
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_LINUX_SYSCALL_HOOKS_H
#define SANITIZER_LINUX_SYSCALL_HOOKS_H

Source(s): system/lib/compiler-rt/include/sanitizer/lsan_interface.h

//===-- sanitizer/lsan_interface.h ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
//
// Public interface header.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_LSAN_INTERFACE_H
#define SANITIZER_LSAN_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/memprof_interface.h

//===-- sanitizer/memprof_interface.h --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of MemProfiler (MemProf).
//
// Public interface header.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_MEMPROF_INTERFACE_H
#define SANITIZER_MEMPROF_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/msan_interface.h

//===-- msan_interface.h --------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of MemorySanitizer.
//
// Public interface header.
//===----------------------------------------------------------------------===//
#ifndef MSAN_INTERFACE_H
#define MSAN_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/netbsd_syscall_hooks.h

//===-- netbsd_syscall_hooks.h --------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of public sanitizer interface.
//
// System call handlers.
//
// Interface methods declared in this header implement pre- and post- syscall
// actions for the active sanitizer.
// Usage:
//   __sanitizer_syscall_pre_getfoo(...args...);
//   long long res = syscall(SYS_getfoo, ...args...);
//   __sanitizer_syscall_post_getfoo(res, ...args...);
//
// DO NOT EDIT! THIS FILE HAS BEEN GENERATED!
//
// Generated with: generate_netbsd_syscalls.awk
// Generated date: 2020-09-10
// Generated from: syscalls.master,v 1.306 2020/08/14 00:53:16 riastradh Exp
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_NETBSD_SYSCALL_HOOKS_H
#define SANITIZER_NETBSD_SYSCALL_HOOKS_H

Source(s): system/lib/compiler-rt/include/sanitizer/nsan_interface.h

//===-- sanitizer/nsan_interface.h ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Public interface for nsan.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_NSAN_INTERFACE_H
#define SANITIZER_NSAN_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/rtsan_interface.h

//===-- sanitizer/rtsan_interface.h -----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of RealtimeSanitizer.
//
// Public interface header.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/include/sanitizer/scudo_interface.h

//===-- sanitizer/scudo_interface.h -----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
/// Public Scudo interface header.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_SCUDO_INTERFACE_H_
#define SANITIZER_SCUDO_INTERFACE_H_

Source(s): system/lib/compiler-rt/include/sanitizer/tsan_interface.h

//===-- tsan_interface.h ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer (TSan), a race detector.
//
// Public interface header for TSan.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_TSAN_INTERFACE_H
#define SANITIZER_TSAN_INTERFACE_H

Source(s): system/lib/compiler-rt/include/sanitizer/tsan_interface_atomic.h

//===-- tsan_interface_atomic.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer (TSan), a race detector.
//
// Public interface header for TSan atomics.
//===----------------------------------------------------------------------===//
#ifndef TSAN_INTERFACE_ATOMIC_H
#define TSAN_INTERFACE_ATOMIC_H

Source(s): system/lib/compiler-rt/include/sanitizer/ubsan_interface.h

//===-- sanitizer/ubsan_interface.h -----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of UBSanitizer (UBSan).
//
// Public interface header.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_UBSAN_INTERFACE_H
#define SANITIZER_UBSAN_INTERFACE_H

Source(s): system/lib/compiler-rt/lib/asan/asan_activation.cpp

//===-- asan_activation.cpp -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan activation/deactivation logic.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_activation.h

//===-- asan_activation.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan activation/deactivation logic.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_activation_flags.inc

//===-- asan_activation_flags.inc -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// A subset of ASan (and common) runtime flags supported at activation time.
//
//===----------------------------------------------------------------------===//
#ifndef ASAN_ACTIVATION_FLAG
# error "Define ASAN_ACTIVATION_FLAG prior to including this file!"
#endif

Source(s): system/lib/compiler-rt/lib/asan/asan_aix.cpp

//===-- asan_aix.cpp ------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// AIX-specific details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_allocator.cpp

//===-- asan_allocator.cpp ------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Implementation of ASan's memory allocator, 2-nd version.
// This variant uses the allocator from sanitizer_common, i.e. the one shared
// with ThreadSanitizer and MemorySanitizer.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_allocator.h

//===-- asan_allocator.h ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_allocator.cpp.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_debugging.cpp

//===-- asan_debugging.cpp ------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This file contains various functions that are generally useful to call when
// using a debugger (LLDB, GDB).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_descriptions.cpp

//===-- asan_descriptions.cpp -----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan functions for getting information about an address and/or printing it.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_descriptions.h

//===-- asan_descriptions.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_descriptions.cpp.
// TODO(filcab): Most struct definitions should move to the interface headers.
//===----------------------------------------------------------------------===//
#ifndef ASAN_DESCRIPTIONS_H
#define ASAN_DESCRIPTIONS_H

Source(s): system/lib/compiler-rt/lib/asan/asan_errors.cpp

//===-- asan_errors.cpp -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan implementation for error structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_errors.h

//===-- asan_errors.h -------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for error structures.
//===----------------------------------------------------------------------===//
#ifndef ASAN_ERRORS_H
#define ASAN_ERRORS_H

Source(s): system/lib/compiler-rt/lib/asan/asan_fake_stack.cpp

//===-- asan_fake_stack.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// FakeStack is used to detect use-after-return bugs.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_fake_stack.h

//===-- asan_fake_stack.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_fake_stack.cpp, implements FakeStack.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_flags.cpp

//===-- asan_flags.cpp ------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan flag parsing logic.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_flags.h

//===-- asan_flags.h -------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan runtime flags.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_flags.inc

//===-- asan_flags.inc ------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// ASan runtime flags.
//
//===----------------------------------------------------------------------===//
#ifndef ASAN_FLAG
# error "Define ASAN_FLAG prior to including this file!"
#endif

Source(s): system/lib/compiler-rt/lib/asan/asan_fuchsia.cpp

//===-- asan_fuchsia.cpp -------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Fuchsia-specific details.
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_globals.cpp

//===-- asan_globals.cpp --------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Handle globals.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_globals_win.cpp

//===-- asan_globals_win.cpp ----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Global registration code that is linked into every Windows DLL and EXE.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_init_version.h

//===-- asan_init_version.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This header defines a versioned __asan_init function to be called at the
// startup of the instrumented program.
//===----------------------------------------------------------------------===//
#ifndef ASAN_INIT_VERSION_H
#define ASAN_INIT_VERSION_H

Source(s): system/lib/compiler-rt/lib/asan/asan_interceptors.cpp

//===-- asan_interceptors.cpp ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Intercept various libc functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_interceptors.h

//===-- asan_interceptors.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_interceptors.cpp
//===----------------------------------------------------------------------===//
#ifndef ASAN_INTERCEPTORS_H
#define ASAN_INTERCEPTORS_H

Source(s): system/lib/compiler-rt/lib/asan/asan_interceptors_memintrinsics.cpp

//===-- asan_interceptors_memintrinsics.cpp -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan versions of memcpy, memmove, and memset.
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_interceptors_memintrinsics.h

//===-- asan_interceptors_memintrinsics.h -----------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_interceptors_memintrinsics.cpp
//===---------------------------------------------------------------------===//
#ifndef ASAN_MEMINTRIN_H
#define ASAN_MEMINTRIN_H

Source(s): system/lib/compiler-rt/lib/asan/asan_interface.inc

//===-- asan_interface.inc ------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
// Asan interface list.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_interface_internal.h

//===-- asan_interface_internal.h -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This header declares the AddressSanitizer runtime interface functions.
// The runtime library has to define these functions so the instrumented program
// could call them.
//
// See also include/sanitizer/asan_interface.h
//===----------------------------------------------------------------------===//
#ifndef ASAN_INTERFACE_INTERNAL_H
#define ASAN_INTERFACE_INTERNAL_H

Source(s): system/lib/compiler-rt/lib/asan/asan_internal.h

//===-- asan_internal.h -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header which defines various general utilities.
//===----------------------------------------------------------------------===//
#ifndef ASAN_INTERNAL_H
#define ASAN_INTERNAL_H

Source(s): system/lib/compiler-rt/lib/asan/asan_linux.cpp

//===-- asan_linux.cpp ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Linux-specific details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_mac.cpp

//===-- asan_mac.cpp ------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Mac-specific details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_malloc_linux.cpp

//===-- asan_malloc_linux.cpp ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Linux-specific malloc interception.
// We simply define functions like malloc, free, realloc, etc.
// They will replace the corresponding libc functions automagically.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_malloc_mac.cpp

//===-- asan_malloc_mac.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Mac-specific malloc interception.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_malloc_win.cpp

//===-- asan_malloc_win.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Windows-specific malloc interception.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_malloc_win_thunk.cpp

//===-- asan_malloc_win_thunk.cpp
//-----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Windows-specific malloc interception.
// This is included statically for projects statically linking
// with the C Runtime (/MT, /MTd) in order to provide ASAN-aware
// versions of the C allocation functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_mapping.h

//===-- asan_mapping.h ------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Defines ASan memory mapping.
//===----------------------------------------------------------------------===//
#ifndef ASAN_MAPPING_H
#define ASAN_MAPPING_H

Source(s): system/lib/compiler-rt/lib/asan/asan_mapping_emscripten.h

//===-- asan_mapping_emscripten.h -------------------------------*- C++ -*-===//
//
//                     The LLVM Compiler Infrastructure
//
// This file is distributed under the University of Illinois Open Source
// License. See LICENSE.TXT for details.
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Emscripten-specific definitions for ASan memory mapping.
//===----------------------------------------------------------------------===//
#ifndef ASAN_MAPPING_EMSCRIPTEN_H
#define ASAN_MAPPING_EMSCRIPTEN_H

Source(s): system/lib/compiler-rt/lib/asan/asan_mapping_sparc64.h

//===-- asan_mapping_sparc64.h ----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// SPARC64-specific definitions for ASan memory mapping.
//===----------------------------------------------------------------------===//
#ifndef ASAN_MAPPING_SPARC64_H
#define ASAN_MAPPING_SPARC64_H

Source(s): system/lib/compiler-rt/lib/asan/asan_memory_profile.cpp

//===-- asan_memory_profile.cpp ----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This file implements __sanitizer_print_memory_profile.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_new_delete.cpp

//===-- asan_interceptors.cpp ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Interceptors for operators new and delete.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_poisoning.cpp

//===-- asan_poisoning.cpp ------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Shadow memory poisoning by ASan RTL and by user application.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_poisoning.h

//===-- asan_poisoning.h ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Shadow memory poisoning by ASan RTL and by user application.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_posix.cpp

//===-- asan_posix.cpp ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Posix-specific details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_preinit.cpp

//===-- asan_preinit.cpp --------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Call __asan_init at the very early stage of process startup.
//===----------------------------------------------------------------------===//
#include "asan_internal.h"

Source(s): system/lib/compiler-rt/lib/asan/asan_premap_shadow.cpp

//===-- asan_premap_shadow.cpp --------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Reserve shadow memory with an ifunc resolver.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_premap_shadow.h

//===-- asan_mapping.h ------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Premap shadow range with an ifunc resolver.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_report.cpp

//===-- asan_report.cpp ---------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This file contains error reporting code.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_report.h

//===-- asan_report.h -------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for error reporting functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_rtl.cpp

//===-- asan_rtl.cpp ------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Main file of the ASan run-time library.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_rtl_static.cpp

//===-- asan_static_rtl.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Main file of the ASan run-time library.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_scariness_score.h

//===-- asan_scariness_score.h ----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Compute the level of scariness of the error message.
// Don't expect any deep science here, just a set of heuristics that suggest
// that e.g. 1-byte-read-global-buffer-overflow is less scary than
// 8-byte-write-stack-use-after-return.
//
// Every error report has one or more features, such as memory access size,
// type (read or write), type of accessed memory (e.g. free-d heap, or a global
// redzone), etc. Every such feature has an int score and a string description.
// The overall score is the sum of all feature scores and the description
// is a concatenation of feature descriptions.
// Examples:
//  17 (4-byte-read-heap-buffer-overflow)
//  65 (multi-byte-write-stack-use-after-return)
//  10 (null-deref)
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_shadow_setup.cpp

//===-- asan_shadow_setup.cpp ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Set up the shadow memory.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_stack.cpp

//===-- asan_stack.cpp ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Code for ASan stack trace.
//===----------------------------------------------------------------------===//
#include "asan_internal.h"
#include "asan_stack.h"
#include "sanitizer_common/sanitizer_atomic.h"

Source(s): system/lib/compiler-rt/lib/asan/asan_stack.h

//===-- asan_stack.h --------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_stack.cpp.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_stats.cpp

//===-- asan_stats.cpp ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Code related to statistics collected by AddressSanitizer.
//===----------------------------------------------------------------------===//
#include "asan_interceptors.h"
#include "asan_internal.h"
#include "asan_stats.h"
#include "asan_thread.h"
#include "sanitizer_common/sanitizer_allocator_interface.h"
#include "sanitizer_common/sanitizer_mutex.h"
#include "sanitizer_common/sanitizer_stackdepot.h"

Source(s): system/lib/compiler-rt/lib/asan/asan_stats.h

//===-- asan_stats.h --------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for statistics.
//===----------------------------------------------------------------------===//
#ifndef ASAN_STATS_H
#define ASAN_STATS_H

Source(s): system/lib/compiler-rt/lib/asan/asan_suppressions.cpp

//===-- asan_suppressions.cpp ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Issue suppression and suppression-related functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_suppressions.h

//===-- asan_suppressions.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_suppressions.cpp.
//===----------------------------------------------------------------------===//
#ifndef ASAN_SUPPRESSIONS_H
#define ASAN_SUPPRESSIONS_H

Source(s): system/lib/compiler-rt/lib/asan/asan_thread.cpp

//===-- asan_thread.cpp ---------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Thread-related code.
//===----------------------------------------------------------------------===//
#include "asan_thread.h"

Source(s): system/lib/compiler-rt/lib/asan/asan_thread.h

//===-- asan_thread.h -------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// ASan-private header for asan_thread.cpp.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_win.cpp

//===-- asan_win.cpp
//------------------------------------------------------===//>
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Windows-specific details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_win_common_runtime_thunk.cpp

//===-- asan_win_common_runtime_thunk.cpp --------------------------- -----===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This file defines things that need to be present in the application modules
// to interact with the ASan DLL runtime correctly and can't be implemented
// using the default "import library" generated when linking the DLL.
//
// This includes:
//  - Cloning shadow memory dynamic address from ASAN DLL
//  - Creating weak aliases to default implementation imported from asan dll
//  - Forwarding the detect_stack_use_after_return runtime option
//  - installing a custom SEH handler
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_win_common_runtime_thunk.h

//===-- asan_win_common_runtime_thunk.h -------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This file defines things that need to be present in the application modules
// to interact with the ASan DLL runtime correctly and can't be implemented
// using the default "import library" generated when linking the DLL.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_win_dynamic_runtime_thunk.cpp

//===-- asan_win_dynamic_runtime_thunk.cpp --------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This file defines things that need to be present for application modules
// that are dynamic linked with the C Runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/asan/asan_win_static_runtime_thunk.cpp

//===-- asan_win_static_runtime_thunk.cpp ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// This file defines a family of thunks that should be statically linked into
// modules that are statically linked with the C Runtime in order to delegate
// the calls to the ASAN runtime DLL.
// See https://github.com/google/sanitizers/issues/209 for the details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/absvdi2.c

//===-- absvdi2.c - Implement __absvdi2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __absvdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/absvsi2.c

//===-- absvsi2.c - Implement __absvsi2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __absvsi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/absvti2.c

//===-- absvti2.c - Implement __absvdi2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __absvti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/adddf3.c

//===-- lib/adddf3.c - Double-precision addition ------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements double-precision soft-float addition.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/addsf3.c

//===-- lib/addsf3.c - Single-precision addition ------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements single-precision soft-float addition.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/addtf3.c

//===-- lib/addtf3.c - Quad-precision addition --------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements quad-precision soft-float addition.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/addvdi3.c

//===-- addvdi3.c - Implement __addvdi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __addvdi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/addvsi3.c

//===-- addvsi3.c - Implement __addvsi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __addvsi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/addvti3.c

//===-- addvti3.c - Implement __addvti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __addvti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/apple_versioning.c

//===-- apple_versioning.c - Adds versioning symbols for ld ---------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ashldi3.c

// ====-- ashldi3.c - Implement __ashldi3 ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ashldi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ashlti3.c

//===-- ashlti3.c - Implement __ashlti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ashlti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ashrdi3.c

//===-- ashrdi3.c - Implement __ashrdi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ashrdi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ashrti3.c

//===-- ashrti3.c - Implement __ashrti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ashrti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/assembly.h

//===-- assembly.h - compiler-rt assembler support macros -----------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file defines macros for use in compiler-rt assembler source.
// This file is not part of the interface of this library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/atomic.c

//===-- atomic.c - Implement support functions for atomic operations.------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
//  atomic.c defines a set of functions for performing atomic accesses on
//  arbitrary-sized memory locations.  This design uses locks that should
//  be fast in the uncontended case, for two reasons:
//
//  1) This code must work with C programs that do not link to anything
//     (including pthreads) and so it should not depend on any pthread
//     functions. If the user wishes to opt into using pthreads, they may do so.
//  2) Atomic operations, rather than explicit mutexes, are most commonly used
//     on code where contended operations are rate.
//
//  To avoid needing a per-object lock, this code allocates an array of
//  locks and hashes the object pointers to find the one that it should use.
//  For operations that must be atomic on two locations, the lower lock is
//  always acquired first, to avoid deadlock.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/atomic_flag_clear.c

//===-- atomic_flag_clear.c -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements atomic_flag_clear from C11's stdatomic.h.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/atomic_flag_clear_explicit.c

//===-- atomic_flag_clear_explicit.c --------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements atomic_flag_clear_explicit from C11's stdatomic.h.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/atomic_flag_test_and_set.c

//===-- atomic_flag_test_and_set.c ----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements atomic_flag_test_and_set from C11's stdatomic.h.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/atomic_flag_test_and_set_explicit.c

//===-- atomic_flag_test_and_set_explicit.c -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements atomic_flag_test_and_set_explicit from C11's stdatomic.h
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/atomic_signal_fence.c

//===-- atomic_signal_fence.c ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements atomic_signal_fence from C11's stdatomic.h.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/atomic_thread_fence.c

//===-- atomic_thread_fence.c ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements atomic_thread_fence from C11's stdatomic.h.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/bswapdi2.c

//===-- bswapdi2.c - Implement __bswapdi2 ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __bswapdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/bswapsi2.c

//===-- bswapsi2.c - Implement __bswapsi2 ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __bswapsi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/clear_cache.c

//===-- clear_cache.c - Implement __clear_cache ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/clear_cache.c

#elif defined(__linux__)
// We used to include asm/unistd.h for the __ARM_NR_cacheflush define, but
// it also brought many other unused defines, as well as a dependency on
// kernel headers to be installed.
//
// This value is stable at least since Linux 3.13 and should remain so for
// compatibility reasons, warranting it's re-definition here.
#define __ARM_NR_cacheflush 0x0f0002

Source(s): system/lib/compiler-rt/lib/builtins/clzdi2.c

//===-- clzdi2.c - Implement __clzdi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __clzdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/clzsi2.c

//===-- clzsi2.c - Implement __clzsi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __clzsi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/clzti2.c

//===-- clzti2.c - Implement __clzti2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __clzti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/cmpdi2.c

//===-- cmpdi2.c - Implement __cmpdi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __cmpdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/cmpti2.c

//===-- cmpti2.c - Implement __cmpti2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __cmpti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/comparedf2.c

//===-- lib/comparedf2.c - Double-precision comparisons -----------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// // This file implements the following soft-float comparison routines:
//
//   __eqdf2   __gedf2   __unorddf2
//   __ledf2   __gtdf2
//   __ltdf2
//   __nedf2
//
// The semantics of the routines grouped in each column are identical, so there
// is a single implementation for each, and wrappers to provide the other names.
//
// The main routines behave as follows:
//
//   __ledf2(a,b) returns -1 if a < b
//                         0 if a == b
//                         1 if a > b
//                         1 if either a or b is NaN
//
//   __gedf2(a,b) returns -1 if a < b
//                         0 if a == b
//                         1 if a > b
//                        -1 if either a or b is NaN
//
//   __unorddf2(a,b) returns 0 if both a and b are numbers
//                           1 if either a or b is NaN
//
// Note that __ledf2( ) and __gedf2( ) are identical except in their handling of
// NaN values.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/comparesf2.c

//===-- lib/comparesf2.c - Single-precision comparisons -----------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements the following soft-fp_t comparison routines:
//
//   __eqsf2   __gesf2   __unordsf2
//   __lesf2   __gtsf2
//   __ltsf2
//   __nesf2
//
// The semantics of the routines grouped in each column are identical, so there
// is a single implementation for each, and wrappers to provide the other names.
//
// The main routines behave as follows:
//
//   __lesf2(a,b) returns -1 if a < b
//                         0 if a == b
//                         1 if a > b
//                         1 if either a or b is NaN
//
//   __gesf2(a,b) returns -1 if a < b
//                         0 if a == b
//                         1 if a > b
//                        -1 if either a or b is NaN
//
//   __unordsf2(a,b) returns 0 if both a and b are numbers
//                           1 if either a or b is NaN
//
// Note that __lesf2( ) and __gesf2( ) are identical except in their handling of
// NaN values.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/comparetf2.c

//===-- lib/comparetf2.c - Quad-precision comparisons -------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// // This file implements the following soft-float comparison routines:
//
//   __eqtf2   __getf2   __unordtf2
//   __letf2   __gttf2
//   __lttf2
//   __netf2
//
// The semantics of the routines grouped in each column are identical, so there
// is a single implementation for each, and wrappers to provide the other names.
//
// The main routines behave as follows:
//
//   __letf2(a,b) returns -1 if a < b
//                         0 if a == b
//                         1 if a > b
//                         1 if either a or b is NaN
//
//   __getf2(a,b) returns -1 if a < b
//                         0 if a == b
//                         1 if a > b
//                        -1 if either a or b is NaN
//
//   __unordtf2(a,b) returns 0 if both a and b are numbers
//                           1 if either a or b is NaN
//
// Note that __letf2( ) and __getf2( ) are identical except in their handling of
// NaN values.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/crtbegin.c

//===-- crtbegin.c - Start of constructors and destructors ----------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/crtend.c

//===-- crtend.c - End of constructors and destructors --------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ctzdi2.c

//===-- ctzdi2.c - Implement __ctzdi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ctzdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ctzsi2.c

//===-- ctzsi2.c - Implement __ctzsi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ctzsi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ctzti2.c

//===-- ctzti2.c - Implement __ctzti2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ctzti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divdc3.c

//===-- divdc3.c - Implement __divdc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divdc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divdf3.c

//===-- lib/divdf3.c - Double-precision division ------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements double-precision soft-float division
// with the IEEE-754 default rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divdi3.c

//===-- divdi3.c - Implement __divdi3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divdi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divmoddi4.c

//===-- divmoddi4.c - Implement __divmoddi4 -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divmoddi4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divmodsi4.c

//===-- divmodsi4.c - Implement __divmodsi4
//--------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divmodsi4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divmodti4.c

//===-- divmodti4.c - Implement __divmodti4 -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divmodti4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divsc3.c

//===-- divsc3.c - Implement __divsc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divsc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divsf3.c

//===-- lib/divsf3.c - Single-precision division ------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements single-precision soft-float division
// with the IEEE-754 default rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divsi3.c

//===-- divsi3.c - Implement __divsi3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divsi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divtc3.c

//===-- divtc3.c - Implement __divtc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divtc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divtf3.c

//===-- lib/divtf3.c - Quad-precision division --------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements quad-precision soft-float division
// with the IEEE-754 default rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divti3.c

//===-- divti3.c - Implement __divti3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/divxc3.c

//===-- divxc3.c - Implement __divxc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __divxc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/emutls.c

//===---------- emutls.c - Implements __emutls_get_address ---------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/enable_execute_stack.c

//===-- enable_execute_stack.c - Implement __enable_execute_stack ---------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/eprintf.c

//===---------- eprintf.c - Implements __eprintf --------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extendbfsf2.c

//===-- lib/extendbfsf2.c - bfloat -> single conversion -----------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extenddftf2.c

//===-- lib/extenddftf2.c - double -> quad conversion -------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extendhfdf2.c

//===-- lib/extendhfdf2.c - half -> single conversion -------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extendhfsf2.c

//===-- lib/extendhfsf2.c - half -> single conversion -------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extendhftf2.c

//===-- lib/extendhftf2.c - half -> quad conversion ---------------*- C -*-===//
//
//                     The LLVM Compiler Infrastructure
//
// This file is dual licensed under the MIT and the University of Illinois Open
// Source Licenses. See LICENSE.TXT for details.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extendhfxf2.c

//===-- lib/extendhfxf2.c - half -> long double conversion --------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
#include "int_lib.h"
#define SRC_HALF
#define DST_DOUBLE
#include "fp_extend_impl.inc"

Source(s): system/lib/compiler-rt/lib/builtins/extendsfdf2.c

//===-- lib/extendsfdf2.c - single -> double conversion -----------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extendsftf2.c

//===-- lib/extendsftf2.c - single -> quad conversion -------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/extendxftf2.c

//===-- lib/extendxftf2.c - long double -> quad conversion --------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ffsdi2.c

//===-- ffsdi2.c - Implement __ffsdi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ffsdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ffssi2.c

//===-- ffssi2.c - Implement __ffssi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ffssi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ffsti2.c

//===-- ffsti2.c - Implement __ffsti2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ffsti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixdfdi.c

//===-- fixdfdi.c - Implement __fixdfdi -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixdfsi.c

//===-- fixdfsi.c - Implement __fixdfsi -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixdfti.c

//===-- fixdfti.c - Implement __fixdfti -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixsfdi.c

//===-- fixsfdi.c - Implement __fixsfdi -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixsfsi.c

//===-- fixsfsi.c - Implement __fixsfsi -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixsfti.c

//===-- fixsfti.c - Implement __fixsfti -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixtfdi.c

//===-- fixtfdi.c - Implement __fixtfdi -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixtfsi.c

//===-- fixtfsi.c - Implement __fixtfsi -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixtfti.c

//===-- fixtfti.c - Implement __fixtfti -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunsdfdi.c

//===-- fixunsdfdi.c - Implement __fixunsdfdi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunsdfsi.c

//===-- fixunsdfsi.c - Implement __fixunsdfsi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunsdfti.c

//===-- fixunsdfti.c - Implement __fixunsdfti -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunssfdi.c

//===-- fixunssfdi.c - Implement __fixunssfdi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunssfsi.c

//===-- fixunssfsi.c - Implement __fixunssfsi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __fixunssfsi for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunssfti.c

//===-- fixunssfti.c - Implement __fixunssfti -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __fixunssfti for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunstfdi.c

//===-- fixunstfdi.c - Implement __fixunstfdi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunstfsi.c, system/lib/compiler-rt/lib/builtins/fixunstfti.c

//===-- fixunstfsi.c - Implement __fixunstfsi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunsxfdi.c

//===-- fixunsxfdi.c - Implement __fixunsxfdi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __fixunsxfdi for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunsxfsi.c

//===-- fixunsxfsi.c - Implement __fixunsxfsi -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __fixunsxfsi for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixunsxfti.c

//===-- fixunsxfti.c - Implement __fixunsxfti -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __fixunsxfti for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixxfdi.c

//===-- fixxfdi.c - Implement __fixxfdi -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __fixxfdi for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fixxfti.c

//===-- fixxfti.c - Implement __fixxfti -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __fixxfti for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatdidf.c

//===-- floatdidf.c - Implement __floatdidf -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatdidf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatdisf.c

//===-- floatdisf.c - Implement __floatdisf -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatdisf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatditf.c

//===-- lib/floatditf.c - integer -> quad-precision conversion ----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements di_int to quad-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatdixf.c

//===-- floatdixf.c - Implement __floatdixf -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatdixf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatsidf.c

//===-- lib/floatsidf.c - integer -> double-precision conversion --*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements integer to double-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatsisf.c

//===-- lib/floatsisf.c - integer -> single-precision conversion --*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements integer to single-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatsitf.c

//===-- lib/floatsitf.c - integer -> quad-precision conversion ----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements integer to quad-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floattidf.c

//===-- floattidf.c - Implement __floattidf -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floattidf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floattisf.c

//===-- floattisf.c - Implement __floattisf -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floattisf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floattitf.c

//===-- lib/floattitf.c - int128 -> quad-precision conversion -----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements ti_int to quad-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floattixf.c

//===-- floattixf.c - Implement __floattixf -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floattixf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatundidf.c

//===-- floatundidf.c - Implement __floatundidf ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatundidf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatundisf.c

//===-- floatundisf.c - Implement __floatundisf ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatundisf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatunditf.c

//===-- lib/floatunditf.c - uint -> quad-precision conversion -----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements du_int to quad-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatundixf.c

//===-- floatundixf.c - Implement __floatundixf ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatundixf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatunsidf.c

//===-- lib/floatunsidf.c - uint -> double-precision conversion ---*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements unsigned integer to double-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatunsisf.c

//===-- lib/floatunsisf.c - uint -> single-precision conversion ---*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements unsigned integer to single-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatunsitf.c

//===-- lib/floatunsitf.c - uint -> quad-precision conversion -----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements unsigned integer to quad-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatuntidf.c

//===-- floatuntidf.c - Implement __floatuntidf ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatuntidf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatuntisf.c

//===-- floatuntisf.c - Implement __floatuntisf ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatuntisf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatuntitf.c

//===-- lib/floatuntitf.c - uint128 -> quad-precision conversion --*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements tu_int to quad-precision conversion for the
// compiler-rt library in the IEEE-754 default round-to-nearest, ties-to-even
// mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/floatuntixf.c

//===-- floatuntixf.c - Implement __floatuntixf ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __floatuntixf for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_add_impl.inc

//===----- lib/fp_add_impl.inc - floaing point addition -----------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements soft-float addition with the IEEE-754 default rounding
// (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_compare_impl.inc

//===-- lib/fp_compare_impl.inc - Floating-point comparison -------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_div_impl.inc

//===-- fp_div_impl.inc - Floating point division -----------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements soft-float division with the IEEE-754 default
// rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_extend.h

//===-lib/fp_extend.h - low precision -> high precision conversion -*- C
//-*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Set source and destination setting
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_extend_impl.inc

//=-lib/fp_extend_impl.inc - low precision -> high precision conversion -*-- -//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements a fairly generic conversion from a narrower to a wider
// IEEE-754 floating-point type.  The constants and types defined following the
// includes below parameterize the conversion.
//
// It does not support types that don't use the usual IEEE-754 interchange
// formats; specifically, some work would be needed to adapt it to
// (for example) the Intel 80-bit format or PowerPC double-double format.
//
// Note please, however, that this implementation is only intended to support
// *widening* operations; if you need to convert to a *narrower* floating-point
// type (e.g. double -> float), then this routine will not do what you want it
// to.
//
// It also requires that integer types at least as large as both formats
// are available on the target platform; this may pose a problem when trying
// to add support for quad on some 32-bit systems, for example.  You also may
// run into trouble finding an appropriate CLZ function for wide source types;
// you will likely need to roll your own on some platforms.
//
// Finally, the following assumptions are made:
//
// 1. Floating-point types and integer types have the same endianness on the
//    target platform.
//
// 2. Quiet NaNs, if supported, are indicated by the leading bit of the
//    significand field being set.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_fixint_impl.inc

//===-- lib/fixdfsi.c - Double-precision -> integer conversion ----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements float to integer conversion for the
// compiler-rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_fixuint_impl.inc

//===-- lib/fixdfsi.c - Double-precision -> integer conversion ----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements float to unsigned integer conversion for the
// compiler-rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_lib.h

//===-- lib/fp_lib.h - Floating-point utilities -------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a configuration header for soft-float routines in compiler-rt.
// This file does not provide any part of the compiler-rt interface, but defines
// many useful constants and utility routines that are used in the
// implementation of the soft-float routines in compiler-rt.
//
// Assumes that float, double and long double correspond to the IEEE-754
// binary32, binary64 and binary 128 types, respectively, and that integer
// endianness matches floating point endianness on the target platform.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_mode.c

//===----- lib/fp_mode.c - Floaing-point environment mode utilities --C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file provides a default implementation of fp_mode.h for architectures
// that does not support or does not have an implementation of floating point
// environment mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_mode.h

//===----- lib/fp_mode.h - Floaing-point environment mode utilities --C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is not part of the interface of this library.
//
// This file defines an interface for accessing hardware floating point
// environment mode.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_mul_impl.inc

//===---- lib/fp_mul_impl.inc - floating point multiplication -----*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements soft-float multiplication with the IEEE-754 default
// rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_trunc.h

//=== lib/fp_trunc.h - high precision -> low precision conversion *- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Set source and destination precision setting
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/fp_trunc_impl.inc

//= lib/fp_trunc_impl.inc - high precision -> low precision conversion *-*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements a fairly generic conversion from a wider to a narrower
// IEEE-754 floating-point type in the default (round to nearest, ties to even)
// rounding mode.  The constants and types defined following the includes below
// parameterize the conversion.
//
// This routine can be trivially adapted to support conversions to
// half-precision or from quad-precision. It does not support types that don't
// use the usual IEEE-754 interchange formats; specifically, some work would be
// needed to adapt it to (for example) the Intel 80-bit format or PowerPC
// double-double format.
//
// Note please, however, that this implementation is only intended to support
// *narrowing* operations; if you need to convert to a *wider* floating-point
// type (e.g. float -> double), then this routine will not do what you want it
// to.
//
// It also requires that integer types at least as large as both formats
// are available on the target platform; this may pose a problem when trying
// to add support for quad on some 32-bit systems, for example.
//
// Finally, the following assumptions are made:
//
// 1. Floating-point types and integer types have the same endianness on the
//    target platform.
//
// 2. Quiet NaNs, if supported, are indicated by the leading bit of the
//    significand field being set.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/gcc_personality_v0.c

//===-- gcc_personality_v0.c - Implement __gcc_personality_v0 -------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_div_impl.inc

//===-- int_div_impl.inc - Integer division ---------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Helpers used by __udivsi3, __umodsi3, __udivdi3, and __umodsi3.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_endianness.h

//===-- int_endianness.h - configuration header for compiler-rt -----------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a configuration header for compiler-rt.
// This file is not part of the interface of this library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_lib.h

//===-- int_lib.h - configuration header for compiler-rt  -----------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a configuration header for compiler-rt.
// This file is not part of the interface of this library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_math.h

//===-- int_math.h - internal math inlines --------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is not part of the interface of this library.
//
// This file defines substitutes for the libm functions used in some of the
// compiler-rt implementations, defined in such a way that there is not a direct
// dependency on libm or math.h. Instead, we use the compiler builtin versions
// where available. This reduces our dependencies on the system SDK by foisting
// the responsibility onto the compiler.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_mulo_impl.inc

//===-- int_mulo_impl.inc - Implement __mulo[sdt]i4 ---------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Helper used by __mulosi4, __mulodi4 and __muloti4.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_mulv_impl.inc

//===-- int_mulv_impl.inc - Implement __mulv[sdt]i3 ---------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Helper used by __mulvsi3, __mulvdi3 and __mulvti3.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_to_fp.h

//===-- int_to_fp.h - integer to floating point conversion ----------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Set source and destination defines in order to use a correctly
// parameterised floatXiYf implementation.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_to_fp_impl.inc

//===-- int_to_fp_impl.inc - integer to floating point conversion ---------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements a generic conversion from an integer type to an
// IEEE-754 floating point type, allowing a common implementation to be shared
// without copy and paste.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_types.h

//===-- int_lib.h - configuration header for compiler-rt  -----------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is not part of the interface of this library.
//
// This file defines various standard types, most importantly a number of unions
// used to access parts of larger types.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_util.c

//===-- int_util.c - Implement internal utilities -------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/int_util.h

//===-- int_util.h - internal utility functions ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is not part of the interface of this library.
//
// This file defines non-inline utilities which are available for use in the
// library. The function definitions themselves are all contained in int_util.c
// which will always be compiled into any compiler-rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/lshrdi3.c

//===-- lshrdi3.c - Implement __lshrdi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __lshrdi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/lshrti3.c

//===-- lshrti3.c - Implement __lshrti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __lshrti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/moddi3.c

//===-- moddi3.c - Implement __moddi3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __moddi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/modsi3.c

//===-- modsi3.c - Implement __modsi3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __modsi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/modti3.c

//===-- modti3.c - Implement __modti3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __modti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/muldc3.c

//===-- muldc3.c - Implement __muldc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __muldc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/muldf3.c

//===-- lib/muldf3.c - Double-precision multiplication ------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements double-precision soft-float multiplication
// with the IEEE-754 default rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/muldi3.c

//===-- muldi3.c - Implement __muldi3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __muldi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulodi4.c

//===-- mulodi4.c - Implement __mulodi4 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __mulodi4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulosi4.c

//===-- mulosi4.c - Implement __mulosi4 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __mulosi4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/muloti4.c

//===-- muloti4.c - Implement __muloti4 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __muloti4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulsc3.c

//===-- mulsc3.c - Implement __mulsc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __mulsc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulsf3.c

//===-- lib/mulsf3.c - Single-precision multiplication ------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements single-precision soft-float multiplication
// with the IEEE-754 default rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/multc3.c

//===-- multc3.c - Implement __multc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __multc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/multf3.c

//===-- lib/multf3.c - Quad-precision multiplication --------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements quad-precision soft-float multiplication
// with the IEEE-754 default rounding (to nearest, ties to even).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/multi3.c

//===-- multi3.c - Implement __multi3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __multi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulvdi3.c

//===-- mulvdi3.c - Implement __mulvdi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __mulvdi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulvsi3.c

//===-- mulvsi3.c - Implement __mulvsi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __mulvsi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulvti3.c

//===-- mulvti3.c - Implement __mulvti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __mulvti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/mulxc3.c

//===-- mulxc3.c - Implement __mulxc3 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __mulxc3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/negdf2.c

//===-- lib/negdf2.c - double-precision negation ------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements double-precision soft-float negation.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/negdi2.c

//===-- negdi2.c - Implement __negdi2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __negdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/negsf2.c

//===-- lib/negsf2.c - single-precision negation ------------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements single-precision soft-float negation.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/negti2.c

//===-- negti2.c - Implement __negti2 -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __negti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/negvdi2.c

//===-- negvdi2.c - Implement __negvdi2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __negvdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/negvsi2.c

//===-- negvsi2.c - Implement __negvsi2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __negvsi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/negvti2.c

//===-- negvti2.c - Implement __negvti2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __negvti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/os_version_check.c

//===-- os_version_check.c - OS version checking  -------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements the function __isOSVersionAtLeast, used by
// Objective-C's @available
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/paritydi2.c

//===-- paritydi2.c - Implement __paritydi2 -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __paritydi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/paritysi2.c

//===-- paritysi2.c - Implement __paritysi2 -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __paritysi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/parityti2.c

//===-- parityti2.c - Implement __parityti2 -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __parityti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/popcountdi2.c

//===-- popcountdi2.c - Implement __popcountdi2 ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __popcountdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/popcountsi2.c

//===-- popcountsi2.c - Implement __popcountsi2 ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __popcountsi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/popcountti2.c

//===-- popcountti2.c - Implement __popcountti2
//----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __popcountti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/powidf2.c

//===-- powidf2.cpp - Implement __powidf2 ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __powidf2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/powisf2.c

//===-- powisf2.cpp - Implement __powisf2 ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __powisf2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/powitf2.c

//===-- powitf2.cpp - Implement __powitf2 ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __powitf2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/powixf2.c

//===-- powixf2.cpp - Implement __powixf2 ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __powixf2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/subdf3.c

//===-- lib/adddf3.c - Double-precision subtraction ---------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements double-precision soft-float subtraction.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/subsf3.c

//===-- lib/subsf3.c - Single-precision subtraction ---------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements single-precision soft-float subtraction.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/subtf3.c

//===-- lib/subtf3.c - Quad-precision subtraction -----------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements quad-precision soft-float subtraction.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/subvdi3.c

//===-- subvdi3.c - Implement __subvdi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __subvdi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/subvsi3.c

//===-- subvsi3.c - Implement __subvsi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __subvsi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/subvti3.c

//===-- subvti3.c - Implement __subvti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __subvti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/trampoline_setup.c

//===----- trampoline_setup.c - Implement __trampoline_setup -------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/truncdfbf2.c

//===-- lib/truncdfbf2.c - double -> bfloat conversion ------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/truncdfhf2.c

//===-- lib/truncdfhf2.c - double -> half conversion --------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/truncdfsf2.c

//===-- lib/truncdfsf2.c - double -> single conversion ------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/truncsfbf2.c

//===-- lib/truncsfbf2.c - single -> bfloat conversion ------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/truncsfhf2.c

//===-- lib/truncsfhf2.c - single -> half conversion --------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/trunctfbf2.c

//===--------- lib/trunctfbf2.c - quad -> bfloat conversion -------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
#define QUAD_PRECISION
#include "fp_lib.h"

Source(s): system/lib/compiler-rt/lib/builtins/trunctfdf2.c

//===-- lib/truncdfsf2.c - quad -> double conversion --------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/trunctfhf2.c

//===-- lib/trunctfhf2.c - quad -> half conversion ----------------*- C -*-===//
//
//                     The LLVM Compiler Infrastructure
//
// This file is dual licensed under the MIT and the University of Illinois Open
// Source Licenses. See LICENSE.TXT for details.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/trunctfsf2.c

//===-- lib/trunctfsf2.c - quad -> single conversion --------------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/trunctfxf2.c

//===-- lib/trunctfsf2.c - long double -> quad conversion ---------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/truncxfbf2.c

//===-- lib/truncxfbf2.c - long double -> bfloat conversion -------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/truncxfhf2.c

//===-- lib/truncsfhf2.c - long double -> half conversion ---------*- C -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ucmpdi2.c

//===-- ucmpdi2.c - Implement __ucmpdi2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ucmpdi2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/ucmpti2.c

//===-- ucmpti2.c - Implement __ucmpti2 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __ucmpti2 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/udivdi3.c

//===-- udivdi3.c - Implement __udivdi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __udivdi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/udivmoddi4.c

//===-- udivmoddi4.c - Implement __udivmoddi4 -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __udivmoddi4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/udivmodsi4.c

//===-- udivmodsi4.c - Implement __udivmodsi4 -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __udivmodsi4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/udivmodti4.c

//===-- udivmodti4.c - Implement __udivmodti4 -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __udivmodti4 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/udivsi3.c

//===-- udivsi3.c - Implement __udivsi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __udivsi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/udivti3.c

//===-- udivti3.c - Implement __udivti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __udivti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/umoddi3.c

//===-- umoddi3.c - Implement __umoddi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __umoddi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/umodsi3.c

//===-- umodsi3.c - Implement __umodsi3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __umodsi3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/umodti3.c

//===-- umodti3.c - Implement __umodti3 -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements __umodti3 for the compiler_rt library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/builtins/unwind-ehabi-helpers.h

//===-- arm-ehabi-helpers.h - Supplementary ARM EHABI declarations --------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===--------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception.h

//===-- interception.h ------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Machinery for providing replacements/wrappers for system functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_aix.cpp

//===-- interception_aix.cpp ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// AIX-specific interception methods.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_aix.h

//===-- interception_aix.h --------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// AIX-specific interception methods.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_linux.cpp

//===-- interception_linux.cpp ----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Linux-specific interception methods.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_linux.h

//===-- interception_linux.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Linux-specific interception methods.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_mac.cpp

//===-- interception_mac.cpp ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Mac-specific interception methods.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_mac.h

//===-- interception_mac.h --------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Mac-specific interception methods.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_type_test.cpp

//===-- interception_type_test.cpp ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Compile-time tests of the internal type definitions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_win.cpp

//===-- interception_win.cpp ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Windows-specific interception methods.
//
// This file is implementing several hooking techniques to intercept calls
// to functions. The hooks are dynamically installed by modifying the assembly
// code.
//
// The hooking techniques are making assumptions on the way the code is
// generated and are safe under these assumptions.
//
// On 64-bit architecture, there is no direct 64-bit jump instruction. To allow
// arbitrary branching on the whole memory space, the notion of trampoline
// region is used. A trampoline region is a memory space withing 2G boundary
// where it is safe to add custom assembly code to build 64-bit jumps.
//
// Hooking techniques
// ==================
//
// 1) Detour
//
//    The Detour hooking technique is assuming the presence of a header with
//    padding and an overridable 2-bytes nop instruction (mov edi, edi). The
//    nop instruction can safely be replaced by a 2-bytes jump without any need
//    to save the instruction. A jump to the target is encoded in the function
//    header and the nop instruction is replaced by a short jump to the header.
//
//        head:  5 x nop                 head:  jmp <hook>
//        func:  mov edi, edi    -->     func:  jmp short <head>
//               [...]                   real:  [...]
//
//    This technique is only implemented on 32-bit architecture.
//    Most of the time, Windows API are hookable with the detour technique.
//
// 2) Redirect Jump
//
//    The redirect jump is applicable when the first instruction is a direct
//    jump. The instruction is replaced by jump to the hook.
//
//        func:  jmp <label>     -->     func:  jmp <hook>
//
//    On a 64-bit architecture, a trampoline is inserted.
//
//        func:  jmp <label>     -->     func:  jmp <tramp>
//                                              [...]
//
//                                   [trampoline]
//                                      tramp:  jmp QWORD [addr]
//                                       addr:  .bytes <hook>
//
//    Note: <real> is equivalent to <label>.
//
// 3) HotPatch
//
//    The HotPatch hooking is assuming the presence of a header with padding
//    and a first instruction with at least 2-bytes.
//
//    The reason to enforce the 2-bytes limitation is to provide the minimal
//    space to encode a short jump. HotPatch technique is only rewriting one
//    instruction to avoid breaking a sequence of instructions containing a
//    branching target.
//
//    Assumptions are enforced by MSVC compiler by using the /HOTPATCH flag.
//      see: https://msdn.microsoft.com/en-us/library/ms173507.aspx
//    Default padding length is 5 bytes in 32-bits and 6 bytes in 64-bits.
//
//        head:   5 x nop                head:  jmp <hook>
//        func:   <instr>        -->     func:  jmp short <head>
//                [...]                  body:  [...]
//
//                                   [trampoline]
//                                       real:  <instr>
//                                              jmp <body>
//
//    On a 64-bit architecture:
//
//        head:   6 x nop                head:  jmp QWORD [addr1]
//        func:   <instr>        -->     func:  jmp short <head>
//                [...]                  body:  [...]
//
//                                   [trampoline]
//                                      addr1:  .bytes <hook>
//                                       real:  <instr>
//                                              jmp QWORD [addr2]
//                                      addr2:  .bytes <body>
//
// 4) Trampoline
//
//    The Trampoline hooking technique is the most aggressive one. It is
//    assuming that there is a sequence of instructions that can be safely
//    replaced by a jump (enough room and no incoming branches).
//
//    Unfortunately, these assumptions can't be safely presumed and code may
//    be broken after hooking.
//
//        func:   <instr>        -->     func:  jmp <hook>
//                <instr>
//                [...]                  body:  [...]
//
//                                   [trampoline]
//                                       real:  <instr>
//                                              <instr>
//                                              jmp <body>
//
//    On a 64-bit architecture:
//
//        func:   <instr>        -->     func:  jmp QWORD [addr1]
//                <instr>
//                [...]                  body:  [...]
//
//                                   [trampoline]
//                                      addr1:  .bytes <hook>
//                                       real:  <instr>
//                                              <instr>
//                                              jmp QWORD [addr2]
//                                      addr2:  .bytes <body>
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/interception/interception_win.h

//===-- interception_linux.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of AddressSanitizer, an address sanity checker.
//
// Windows-specific interception methods.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan.cpp

//=-- lsan.cpp ------------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Standalone LSan RTL.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan.h

//=-- lsan.h --------------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Private header for standalone LSan RTL.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_allocator.cpp

//=-- lsan_allocator.cpp --------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// See lsan_allocator.h for details.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_allocator.h

//=-- lsan_allocator.h ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Allocator for standalone LSan.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_common.cpp

//=-- lsan_common.cpp -----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Implementation of common leak checking functionality.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_common.h

//=-- lsan_common.h -------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Private LSan header.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_common_emscripten.cpp

//=-- lsan_common_emscripten.cc--------------------------------------------===//
//
//                     The LLVM Compiler Infrastructure
//
// This file is distributed under the University of Illinois Open Source
// License. See LICENSE.TXT for details.
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Implementation of common leak checking functionality.
// Emscripten-specific code.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_common_fuchsia.cpp

//=-- lsan_common_fuchsia.cpp --------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Implementation of common leak checking functionality. Fuchsia-specific code.
//
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_common_linux.cpp

//=-- lsan_common_linux.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Implementation of common leak checking functionality. Linux/NetBSD-specific
// code.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_common_mac.cpp

//=-- lsan_common_mac.cpp -------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Implementation of common leak checking functionality. Darwin-specific code.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_flags.inc

//===-- lsan_flags.inc ------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// LSan runtime flags.
//
//===----------------------------------------------------------------------===//
#ifndef LSAN_FLAG
# error "Define LSAN_FLAG prior to including this file!"
#endif

Source(s): system/lib/compiler-rt/lib/lsan/lsan_fuchsia.cpp

//=-- lsan_fuchsia.cpp ---------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Standalone LSan RTL code specific to Fuchsia.
//
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_fuchsia.h

//=-- lsan_fuchsia.h ---------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Standalone LSan RTL code specific to Fuchsia.
//
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_interceptors.cpp

//=-- lsan_interceptors.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Interceptors for standalone LSan.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_linux.cpp

//=-- lsan_linux.cpp ------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer. Linux/NetBSD/Fuchsia-specific code.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_mac.cpp

//===-- lsan_mac.cpp ------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer, a memory leak checker.
//
// Mac-specific details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_malloc_mac.cpp

//===-- lsan_malloc_mac.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer (LSan), a memory leak detector.
//
// Mac-specific malloc interception.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_posix.cpp

//=-- lsan_posix.cpp -----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Standalone LSan RTL code common to POSIX-like systems.
//
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_posix.h

//=-- lsan_posix.h -----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Standalone LSan RTL code common to POSIX-like systems.
//
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_preinit.cpp

//===-- lsan_preinit.cpp --------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
//
// Call __lsan_init at the very early stage of process startup.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_thread.cpp

//=-- lsan_thread.cpp -----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// See lsan_thread.h for details.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/lsan/lsan_thread.h

//=-- lsan_thread.h -------------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of LeakSanitizer.
// Thread registry for standalone LSan.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/profile/GCDAProfiling.c

/*===- GCDAProfiling.c - Support library for GCDA file emission -----------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
|*===----------------------------------------------------------------------===*|
|*
|* This file implements the call back routines for the gcov profiling
|* instrumentation pass. Link against this library when running code through
|* the -insert-gcov-profiling LLVM pass.
|*
|* We emit files in a corrupt version of GCOV's "gcda" file format. These files
|* are only close enough that LCOV will happily parse them. Anything that lcov
|* ignores is missing.
|*
|* TODO: gcov is multi-process safe by having each exit open the existing file
|* and append to it. We'd like to achieve that and be thread-safe too.
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfiling.c

/*===- InstrProfiling.c - Support library for PGO instrumentation ---------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfiling.h, system/lib/compiler-rt/lib/profile/InstrProfilingInternal.h

/*===- InstrProfiling.h- Support library for PGO instrumentation ----------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfiling.h

/*!
 * \brief Set the FILE object for writing instrumentation data. Return 0 if set
 * successfully or return 1 if failed.
 *
 * Sets the FILE object to be used for subsequent calls to
 * \a __llvm_profile_write_file(). The profile file name set by environment
 * variable, command-line option, or calls to \a  __llvm_profile_set_filename
 * will be ignored.
 *
 * \c File will not be closed after a call to \a __llvm_profile_write_file() but
 * it may be flushed. Passing NULL restores default behavior.
 *
 * If \c EnableMerge is nonzero, the runtime will always merge profiling data
 * with the contents of the profiling file. If EnableMerge is zero, the runtime
 * may still merge the data if it would have merged for another reason (for
 * example, because of a %m specifier in the file name).
 *
 * Note: There may be multiple copies of the profile runtime (one for each
 * instrumented image/DSO). This API only modifies the file object within the
 * copy of the runtime available to the calling image.
 *
 * Warning: This is a no-op if EnableMerge is 0 in continuous mode (\ref
 * __llvm_profile_is_continuous_mode_enabled), because disable merging requires
 * copying the old profile file to new profile file and this function is usually
 * used when the proess doesn't have permission to open file.
 */

Source(s): system/lib/compiler-rt/lib/profile/InstrProfiling.h

/*!
 * \brief Set the flag that profile data has been dumped to the file.
 * This is useful for users to disable dumping profile data to the file for
 * certain processes in case the processes don't have permission to write to
 * the disks, and trying to do so would result in side effects such as crashes.
 */

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingBuffer.c

/*===- InstrProfilingBuffer.c - Write instrumentation to a memory buffer --===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingFile.c

/*===- InstrProfilingFile.c - Write instrumentation to a file -------------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingInternal.c

/*===- InstrProfilingInternal.c - Support library for PGO instrumentation -===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingMerge.c

/*===- InstrProfilingMerge.c - Profile in-process Merging  ---------------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
|*===----------------------------------------------------------------------===*
|* This file defines the API needed for in-process merging of profile data
|* stored in memory buffer.
\*===---------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingMergeFile.c

/*===- InstrProfilingMergeFile.c - Profile in-process Merging  ------------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
|*===----------------------------------------------------------------------===
|* This file defines APIs needed to support in-process merging for profile data
|* stored in files.
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingNameVar.c

/*===- InstrProfilingNameVar.c - profile name variable setup  -------------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingPlatformAIX.c

/*===- InstrProfilingPlatformAIX.c - Profile data AIX platform ------------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingPlatformDarwin.c

/*===- InstrProfilingPlatformDarwin.c - Profile data on Darwin ------------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingPlatformFuchsia.c

/*===- InstrProfilingPlatformFuchsia.c - Profile data Fuchsia platform ----===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingPlatformLinux.c

/*===- InstrProfilingPlatformLinux.c - Profile data Linux platform ------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingPlatformOther.c

/*===- InstrProfilingPlatformOther.c - Profile data default platform ------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingPlatformWindows.c

/*===- InstrProfilingPlatformWindows.c - Profile data on Windows ----------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingPort.h

/*===- InstrProfilingPort.h- Support library for PGO instrumentation ------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingRuntime.cpp

//===- InstrProfilingRuntime.cpp - PGO runtime initialization -------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingUtil.c

/*===- InstrProfilingUtil.c - Support library for PGO instrumentation -----===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingUtil.h

/*===- InstrProfilingUtil.h - Support library for PGO instrumentation -----===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingValue.c

/*===- InstrProfilingValue.c - Support library for PGO instrumentation ----===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingVersionVar.c

/*===- InstrProfilingVersionVar.c - profile version variable setup  -------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/InstrProfilingWriter.c

/*===- InstrProfilingWriter.c - Write instrumentation to a file or buffer -===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/profile/WindowsMMap.c

/*
 * This code is derived from uClibc (original license follows).
 * https://git.uclibc.org/uClibc/tree/utils/mmap-windows.c
 */

Source(s): system/lib/compiler-rt/lib/profile/WindowsMMap.c

/* mmap() replacement for Windows
 *
 * Author: Mike Frysinger <vapier@gentoo.org>
 * Placed into the public domain
 */

Source(s): system/lib/compiler-rt/lib/profile/WindowsMMap.h

/*===- WindowsMMap.h - Support library for PGO instrumentation ------------===*\
|*
|* Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
|* See https://llvm.org/LICENSE.txt for license information.
|* SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
|*
\*===----------------------------------------------------------------------===*/

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sancov_flags.cpp

//===-- sancov_flags.cpp ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Sanitizer Coverage runtime flags.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sancov_flags.h

//===-- sancov_flags.h ------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Sanitizer Coverage runtime flags.
//
//===----------------------------------------------------------------------===//
#ifndef SANCOV_FLAGS_H
#define SANCOV_FLAGS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sancov_flags.inc

//===-- sancov_flags.inc ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Sanitizer Coverage runtime flags.
//
//===----------------------------------------------------------------------===//
#ifndef SANCOV_FLAG
#error "Defnine SANCOV_FLAG prior to including this file!"
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_addrhashmap.h

//===-- sanitizer_addrhashmap.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Concurrent uptr->T hashmap.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator.cpp

//===-- sanitizer_allocator.cpp -------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
// This allocator is used inside run-times.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator.h

//===-- sanitizer_allocator.h -----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Specialized memory allocator for ThreadSanitizer, MemorySanitizer, etc.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_checks.cpp

//===-- sanitizer_allocator_checks.cpp --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Various checks shared between ThreadSanitizer, MemorySanitizer, etc. memory
// allocators.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_checks.h

//===-- sanitizer_allocator_checks.h ----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Various checks shared between ThreadSanitizer, MemorySanitizer, etc. memory
// allocators.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_combined.h

//===-- sanitizer_allocator_combined.h --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_H
#error This file must be included inside sanitizer_allocator.h
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_dlsym.h

//===-- sanitizer_allocator_dlsym.h -----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Hack: Sanitizer initializer calls dlsym which may need to allocate and call
// back into uninitialized sanitizer.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_interface.h

//===-- sanitizer_allocator_interface.h ------------------------- C++ -----===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Re-declaration of functions from public sanitizer allocator interface.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_internal.h

//===-- sanitizer_allocator_internal.h --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This allocator is used inside run-times.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_local_cache.h

//===-- sanitizer_allocator_local_cache.h -----------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_H
#error This file must be included inside sanitizer_allocator.h
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_primary32.h

//===-- sanitizer_allocator_primary32.h -------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_H
#error This file must be included inside sanitizer_allocator.h
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_primary64.h

//===-- sanitizer_allocator_primary64.h -------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_H
#error This file must be included inside sanitizer_allocator.h
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_report.cpp

//===-- sanitizer_allocator_report.cpp --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
///
/// \file
/// Shared allocator error reporting for ThreadSanitizer, MemorySanitizer, etc.
///
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_report.h

//===-- sanitizer_allocator_report.h ----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
///
/// \file
/// Shared allocator error reporting for ThreadSanitizer, MemorySanitizer, etc.
///
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_secondary.h

//===-- sanitizer_allocator_secondary.h -------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_H
#error This file must be included inside sanitizer_allocator.h
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_size_class_map.h

//===-- sanitizer_allocator_size_class_map.h --------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_H
#error This file must be included inside sanitizer_allocator.h
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_allocator_stats.h

//===-- sanitizer_allocator_stats.h -----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_ALLOCATOR_H
#error This file must be included inside sanitizer_allocator.h
#endif

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_array_ref.h

//===-- sanitizer_array_ref.h -----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_asm.h

//===-- sanitizer_asm.h -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Various support for assembler.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_atomic.h

//===-- sanitizer_atomic.h --------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_atomic_clang.h

//===-- sanitizer_atomic_clang.h --------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
// Not intended for direct inclusion. Include sanitizer_atomic.h.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_atomic_msvc.h

//===-- sanitizer_atomic_msvc.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
// Not intended for direct inclusion. Include sanitizer_atomic.h.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_bitvector.h

//===-- sanitizer_bitvector.h -----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Specializer BitVector implementation.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_bvgraph.h

//===-- sanitizer_bvgraph.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer runtime.
// BVGraph -- a directed graph.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_chained_origin_depot.cpp

//===-- sanitizer_chained_origin_depot.cpp --------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// A storage for chained origins.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_chained_origin_depot.h

//===-- sanitizer_chained_origin_depot.h ------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// A storage for chained origins.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common.cpp

//===-- sanitizer_common.cpp ----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common.h

//===-- sanitizer_common.h --------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between run-time libraries of sanitizers.
//
// It declares common functions and classes that are used in both runtimes.
// Implementation of some functions are provided in sanitizer_common, while
// others must be defined by run-time library itself.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_COMMON_H
#define SANITIZER_COMMON_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_interceptors.inc

//===-- sanitizer_common_interceptors.inc -----------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common function interceptors for tools like AddressSanitizer,
// ThreadSanitizer, MemorySanitizer, etc.
//
// This file should be included into the tool's interceptor file,
// which has to define its own macros:
//   COMMON_INTERCEPTOR_ENTER
//   COMMON_INTERCEPTOR_ENTER_NOIGNORE
//   COMMON_INTERCEPTOR_READ_RANGE
//   COMMON_INTERCEPTOR_WRITE_RANGE
//   COMMON_INTERCEPTOR_INITIALIZE_RANGE
//   COMMON_INTERCEPTOR_DIR_ACQUIRE
//   COMMON_INTERCEPTOR_FD_ACQUIRE
//   COMMON_INTERCEPTOR_FD_RELEASE
//   COMMON_INTERCEPTOR_FD_ACCESS
//   COMMON_INTERCEPTOR_SET_THREAD_NAME
//   COMMON_INTERCEPTOR_DLOPEN
//   COMMON_INTERCEPTOR_ON_EXIT
//   COMMON_INTERCEPTOR_SET_PTHREAD_NAME
//   COMMON_INTERCEPTOR_HANDLE_RECVMSG
//   COMMON_INTERCEPTOR_NOTHING_IS_INITIALIZED
//   COMMON_INTERCEPTOR_MMAP_IMPL
//   COMMON_INTERCEPTOR_MUNMAP_IMPL
//   COMMON_INTERCEPTOR_COPY_STRING
//   COMMON_INTERCEPTOR_STRNDUP_IMPL
//   COMMON_INTERCEPTOR_STRERROR
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_interceptors_format.inc

//===-- sanitizer_common_interceptors_format.inc ----------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Scanf/printf implementation for use in *Sanitizer interceptors.
// Follows http://pubs.opengroup.org/onlinepubs/9699919799/functions/fscanf.html
// and http://pubs.opengroup.org/onlinepubs/9699919799/functions/fprintf.html
// with a few common GNU extensions.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_interceptors_ioctl.inc

//===-- sanitizer_common_interceptors_ioctl.inc -----------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Ioctl handling in common sanitizer interceptors.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_interceptors_memintrinsics.inc

//===-- sanitizer_common_interceptors_memintrinsics.inc ---------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Memintrinsic function interceptors for tools like AddressSanitizer,
// ThreadSanitizer, MemorySanitizer, etc.
//
// These interceptors are part of the common interceptors, but separated out so
// that implementations may add them, if necessary, to a separate source file
// that should define SANITIZER_COMMON_NO_REDEFINE_BUILTINS at the top.
//
// This file should be included into the tool's memintrinsic interceptor file,
// which has to define its own macros:
//   COMMON_INTERCEPTOR_ENTER
//   COMMON_INTERCEPTOR_READ_RANGE
//   COMMON_INTERCEPTOR_WRITE_RANGE
//   COMMON_INTERCEPTOR_MEMSET_IMPL
//   COMMON_INTERCEPTOR_MEMMOVE_IMPL
//   COMMON_INTERCEPTOR_MEMCPY_IMPL
//   COMMON_INTERCEPTOR_NOTHING_IS_INITIALIZED
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_interceptors_netbsd_compat.inc

//===-- sanitizer_common_interceptors_netbsd_compat.inc ---------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common function interceptors for tools like AddressSanitizer,
// ThreadSanitizer, MemorySanitizer, etc.
//
// Interceptors for NetBSD old function calls that have been versioned.
//
// NetBSD minimal version supported 9.0.
// NetBSD current version supported 9.99.26.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_interface.inc

//===-- sanitizer_common_interface.inc ------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
// Sanitizer Common interface list.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_interface_posix.inc

//===-- sanitizer_common_interface_posix.inc ------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
// Sanitizer Common interface list only available for Posix systems.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_libcdep.cpp

//===-- sanitizer_common_libcdep.cpp --------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_nolibc.cpp

//===-- sanitizer_common_nolibc.cpp ---------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file contains stubs for libc function to facilitate optional use of
// libc in no-libcdep sources.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_common_syscalls.inc

//===-- sanitizer_common_syscalls.inc ---------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common syscalls handlers for tools like AddressSanitizer,
// ThreadSanitizer, MemorySanitizer, etc.
//
// This file should be included into the tool's interceptor file,
// which has to define it's own macros:
//   COMMON_SYSCALL_PRE_READ_RANGE
//          Called in prehook for regions that will be read by the kernel and
//          must be initialized.
//   COMMON_SYSCALL_PRE_WRITE_RANGE
//          Called in prehook for regions that will be written to by the kernel
//          and must be addressable. The actual write range may be smaller than
//          reported in the prehook. See POST_WRITE_RANGE.
//   COMMON_SYSCALL_POST_READ_RANGE
//          Called in posthook for regions that were read by the kernel. Does
//          not make much sense.
//   COMMON_SYSCALL_POST_WRITE_RANGE
//          Called in posthook for regions that were written to by the kernel
//          and are now initialized.
//   COMMON_SYSCALL_ACQUIRE(addr)
//          Acquire memory visibility from addr.
//   COMMON_SYSCALL_RELEASE(addr)
//          Release memory visibility to addr.
//   COMMON_SYSCALL_FD_CLOSE(fd)
//          Called before closing file descriptor fd.
//   COMMON_SYSCALL_FD_ACQUIRE(fd)
//          Acquire memory visibility from fd.
//   COMMON_SYSCALL_FD_RELEASE(fd)
//          Release memory visibility to fd.
//   COMMON_SYSCALL_PRE_FORK()
//          Called before fork syscall.
//   COMMON_SYSCALL_POST_FORK(long res)
//          Called after fork syscall.
//   COMMON_SYSCALL_BLOCKING_START()
//         Called before blocking syscall.
//   COMMON_SYSCALL_BLOCKING_END()
//         Called after blocking syscall.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_coverage_fuchsia.cpp

//===-- sanitizer_coverage_fuchsia.cpp ------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Sanitizer Coverage Controller for Trace PC Guard, Fuchsia-specific version.
//
// This Fuchsia-specific implementation uses the same basic scheme and the
// same simple '.sancov' file format as the generic implementation.  The
// difference is that we just produce a single blob of output for the whole
// program, not a separate one per DSO.  We do not sort the PC table and do
// not prune the zeros, so the resulting file is always as large as it
// would be to report 100% coverage.  Implicit tracing information about
// the address ranges of DSOs allows offline tools to split the one big
// blob into separate files that the 'sancov' tool can understand.
//
// Unlike the traditional implementation that uses an atexit hook to write
// out data files at the end, the results on Fuchsia do not go into a file
// per se.  The 'coverage_dir' option is ignored.  Instead, they are stored
// directly into a shared memory object (a Zircon VMO).  At exit, that VMO
// is handed over to a system service that's responsible for getting the
// data out to somewhere that it can be fed into the sancov tool (where and
// how is not our problem).

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_coverage_interface.inc

//===-- sanitizer_coverage_interface.inc ----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
// Sanitizer Coverage interface list.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_coverage_libcdep_new.cpp

//===-- sanitizer_coverage_libcdep_new.cpp --------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
// Sanitizer Coverage Controller for Trace PC Guard.

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_coverage_win_runtime_thunk.cpp

//===-- sanitizer_coverage_win_runtime_thunk.cpp --------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file defines things that need to be present in the application modules
// to interact with Sanitizer Coverage, when it is included in a dll.
//
//===----------------------------------------------------------------------===//
#if defined(SANITIZER_DYNAMIC_RUNTIME_THUNK) || \

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_coverage_win_sections.cpp

//===-- sanitizer_coverage_win_sections.cpp -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file defines delimiters for Sanitizer Coverage's section. It contains
// Windows specific tricks to coax the linker into giving us the start and stop
// addresses of a section, as ELF linkers can do, to get the size of certain
// arrays. According to https://msdn.microsoft.com/en-us/library/7977wcck.aspx
// sections with the same name before "$" are sorted alphabetically by the
// string that comes after "$" and merged into one section. We take advantage
// of this by putting data we want the size of into the middle (M) of a section,
// by using the letter "M" after "$". We get the start of this data (ie:
// __start_section_name) by making the start variable come at the start of the
// section (using the letter A after "$"). We do the same to get the end of the
// data by using the letter "Z" after "$" to make the end variable come after
// the data. Note that because of our technique the address of the start
// variable is actually the address of data that comes before our middle
// section. We also need to prevent the linker from adding any padding. Each
// technique we use for this is explained in the comments below.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_dbghelp.h

//===-- sanitizer_dbghelp.h ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Wrappers for lazy loaded dbghelp.dll. Provides function pointers and a
// callback to initialize them.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_deadlock_detector.h

//===-- sanitizer_deadlock_detector.h ---------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer runtime.
// The deadlock detector maintains a directed graph of lock acquisitions.
// When a lock event happens, the detector checks if the locks already held by
// the current thread are reachable from the newly acquired lock.
//
// The detector can handle only a fixed amount of simultaneously live locks
// (a lock is alive if it has been locked at least once and has not been
// destroyed). When the maximal number of locks is reached the entire graph
// is flushed and the new lock epoch is started. The node ids from the old
// epochs can not be used with any of the detector methods except for
// nodeBelongsToCurrentEpoch().
//
// FIXME: this is work in progress, nothing really works yet.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_deadlock_detector1.cpp

//===-- sanitizer_deadlock_detector1.cpp ----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Deadlock detector implementation based on NxN adjacency bit matrix.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_deadlock_detector2.cpp

//===-- sanitizer_deadlock_detector2.cpp ----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Deadlock detector implementation based on adjacency lists.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_deadlock_detector_interface.h

//===-- sanitizer_deadlock_detector_interface.h -----------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer runtime.
// Abstract deadlock detector interface.
// FIXME: this is work in progress, nothing really works yet.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_dense_map.h

//===- sanitizer_dense_map.h - Dense probed hash table ----------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This is fork of llvm/ADT/DenseMap.h class with the following changes:
//  * Use mmap to allocate.
//  * No iterators.
//  * Does not shrink.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_dense_map_info.h

//===- sanitizer_dense_map_info.h - Type traits for DenseMap ----*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_dl.cpp

//===-- sanitizer_dl.cpp --------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file has helper functions that depend on libc's dynamic loading
// introspection.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_dl.h

//===-- sanitizer_dl.h ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file has helper functions that depend on libc's dynamic loading
// introspection.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_emscripten.cpp

//===-- sanitizer_emscripten.cc -------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This provides implementations of some functions in sanitizer_linux_libcdep.c
// on emscripten. We are not using sanitizer_linux_libcdep.c because it contains
// a lot of threading and other code that does not work with emscripten yet,
// so instead, some minimal implementations are provided here so that UBSan can
// work.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_errno.cpp

//===-- sanitizer_errno.cpp -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizers run-time libraries.
//
// Defines errno to avoid including errno.h and its dependencies into other
// files (e.g. interceptors are not supposed to include any system headers).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_errno.h

//===-- sanitizer_errno.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizers run-time libraries.
//
// Defines errno to avoid including errno.h and its dependencies into sensitive
// files (e.g. interceptors are not supposed to include any system headers).
// It's ok to use errno.h directly when your file already depend on other system
// includes though.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_errno_codes.h

//===-- sanitizer_errno_codes.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizers run-time libraries.
//
// Defines errno codes to avoid including errno.h and its dependencies into
// sensitive files (e.g. interceptors are not supposed to include any system
// headers).
// It's ok to use errno.h directly when your file already depend on other system
// includes though.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_file.cpp

//===-- sanitizer_file.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.  It defines filesystem-related interfaces.  This
// is separate from sanitizer_common.cpp so that it's simpler to disable
// all the filesystem support code for a port that doesn't use it.
//
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_file.h

//===-- sanitizer_file.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// This file is shared between run-time libraries of sanitizers.
// It declares filesystem-related interfaces.  This is separate from
// sanitizer_common.h so that it's simpler to disable all the filesystem
// support code for a port that doesn't use it.
//
//===---------------------------------------------------------------------===//
#ifndef SANITIZER_FILE_H
#define SANITIZER_FILE_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_file.h

// Set to true if the last attempt to open the logfile failed, perhaps due to
  // permission errors

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_flag_parser.cpp

//===-- sanitizer_flag_parser.cpp -----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_flag_parser.h

//===-- sanitizer_flag_parser.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_flags.cpp

//===-- sanitizer_flags.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_flags.h

//===-- sanitizer_flags.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_flags.inc

//===-- sanitizer_flags.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file describes common flags available in all sanitizers.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_flat_map.h

//===-- sanitizer_flat_map.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Part of the Sanitizer Allocator.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_fuchsia.cpp

//===-- sanitizer_fuchsia.cpp ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and other sanitizer
// run-time libraries and implements Fuchsia-specific functions from
// sanitizer_common.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_fuchsia.h

//===-- sanitizer_fuchsia.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// Fuchsia-specific sanitizer support.
//
//===---------------------------------------------------------------------===//
#ifndef SANITIZER_FUCHSIA_H
#define SANITIZER_FUCHSIA_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_getauxval.h

//===-- sanitizer_getauxval.h -----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common getauxval() guards and definitions.
// getauxval() is not defined until glibc version 2.16, or until API level 21
// for Android.
// Implement the getauxval() compat function for NetBSD.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_glibc_version.h

//===-- sanitizer_glibc_version.h -----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_haiku.cpp

//===-- sanitizer_haiku.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between Sanitizer run-time libraries and implements
// Haiku-specific functions from sanitizer_libc.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_hash.h

//===-- sanitizer_common.h --------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file implements a simple hash function.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_interceptors_ioctl_netbsd.inc

//===-- sanitizer_interceptors_ioctl_netbsd.inc -----------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Ioctl handling in common sanitizer interceptors.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_interface_internal.h

//===-- sanitizer_interface_internal.h --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between run-time libraries of sanitizers.
//
// This header declares the sanitizer runtime interface functions.
// The runtime library has to define these functions so the instrumented program
// could call them.
//
// See also include/sanitizer/common_interface_defs.h
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_INTERFACE_INTERNAL_H
#define SANITIZER_INTERFACE_INTERNAL_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_internal_defs.h

//===-- sanitizer_internal_defs.h -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer.
// It contains macro used in run-time libraries code.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_DEFS_H
#define SANITIZER_DEFS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_leb128.h

//===-- sanitizer_leb128.h --------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_lfstack.h

//===-- sanitizer_lfstack.h -=-----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Lock-free stack.
// Uses 32/17 bits as ABA-counter on 32/64-bit platforms.
// The memory passed to Push() must not be ever munmap'ed.
// The type T must contain T *next field.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_libc.cpp

//===-- sanitizer_libc.cpp ------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries. See sanitizer_libc.h for details.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_libc.h

//===-- sanitizer_libc.h ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
// These tools can not use some of the libc functions directly because those
// functions are intercepted. Instead, we implement a tiny subset of libc here.
// FIXME: Some of functions declared in this file are in fact POSIX, not libc.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_libignore.cpp

//===-- sanitizer_libignore.cpp -------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_libignore.h

//===-- sanitizer_libignore.h -----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// LibIgnore allows to ignore all interceptors called from a particular set
// of dynamic libraries. LibIgnore can be initialized with several templates
// of names of libraries to be ignored. It finds code ranges for the libraries;
// and checks whether the provided PC value belongs to the code ranges.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_linux.cpp

//===-- sanitizer_linux.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries and implements linux-specific functions from
// sanitizer_libc.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_linux.h

//===-- sanitizer_linux.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Linux-specific syscall wrappers and classes.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_LINUX_H
#define SANITIZER_LINUX_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_linux_libcdep.cpp

//===-- sanitizer_linux_libcdep.cpp ---------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries and implements linux-specific functions from
// sanitizer_libc.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_linux_s390.cpp

//===-- sanitizer_linux_s390.cpp ------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries and implements s390-linux-specific functions from
// sanitizer_libc.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_list.h

//===-- sanitizer_list.h ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file contains implementation of a list class to be used by
// ThreadSanitizer, etc run-times.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_local_address_space_view.h

//===-- sanitizer_local_address_space_view.h --------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// `LocalAddressSpaceView` provides the local (i.e. target and current address
// space are the same) implementation of the `AddressSpaceView` interface which
// provides a simple interface to load memory from another process (i.e.
// out-of-process)
//
// The `AddressSpaceView` interface requires that the type can be used as a
// template parameter to objects that wish to be able to operate in an
// out-of-process manner. In normal usage, objects are in-process and are thus
// instantiated with the `LocalAddressSpaceView` type. This type is used to
// load any pointers in instance methods. This implementation is effectively
// a no-op. When an object is to be used in an out-of-process manner it is
// instantiated with the `RemoteAddressSpaceView` type.
//
// By making `AddressSpaceView` a template parameter of an object, it can
// change its implementation at compile time which has no run time overhead.
// This also allows unifying in-process and out-of-process code which avoids
// code duplication.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_LOCAL_ADDRES_SPACE_VIEW_H
#define SANITIZER_LOCAL_ADDRES_SPACE_VIEW_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_lzw.h

//===-- sanitizer_lzw.h -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Lempel–Ziv–Welch encoding/decoding
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_mac.cpp

//===-- sanitizer_mac.cpp -------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries and
// implements OSX-specific functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_mac.h

//===-- sanitizer_mac.h -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries and
// provides definitions for OSX-specific functions.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_APPLE_H
#define SANITIZER_APPLE_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_mac_libcdep.cpp

//===-- sanitizer_mac_libcdep.cpp -----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries and
// implements OSX-specific functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_mallinfo.h

//===-- sanitizer_mallinfo.h ----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Definition for mallinfo on different platforms.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_malloc_mac.inc

//===-- sanitizer_malloc_mac.inc --------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file contains Mac-specific malloc interceptors and a custom zone
// implementation, which together replace the system allocator.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_mutex.cpp

//===-- sanitizer_mutex.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_mutex.h

//===-- sanitizer_mutex.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of ThreadSanitizer/AddressSanitizer runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_netbsd.cpp

//===-- sanitizer_netbsd.cpp ----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between Sanitizer run-time libraries and implements
// NetBSD-specific functions from sanitizer_libc.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_placement_new.h

//===-- sanitizer_placement_new.h -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//
// The file provides 'placement new'.
// Do not include it into header files, only into source files.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_PLACEMENT_NEW_H
#define SANITIZER_PLACEMENT_NEW_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform.h

//===-- sanitizer_platform.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common platform macros.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_interceptors.h

//===-- sanitizer_platform_interceptors.h -----------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file defines macro telling whether sanitizer tools can/should intercept
// given library functions on a given platform.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_PLATFORM_INTERCEPTORS_H
#define SANITIZER_PLATFORM_INTERCEPTORS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_freebsd.cpp

//===-- sanitizer_platform_limits_freebsd.cpp -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific FreeBSD data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_freebsd.h

//===-- sanitizer_platform_limits_freebsd.h -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific FreeBSD data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_linux.cpp

//===-- sanitizer_platform_limits_linux.cpp -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of linux kernel data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_netbsd.cpp

//===-- sanitizer_platform_limits_netbsd.cpp ------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific NetBSD data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_netbsd.h

//===-- sanitizer_platform_limits_netbsd.h --------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific NetBSD data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_posix.cpp

//===-- sanitizer_platform_limits_posix.cpp -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific POSIX data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_posix.h

//===-- sanitizer_platform_limits_posix.h ---------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific POSIX data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_solaris.cpp

//===-- sanitizer_platform_limits_solaris.cpp -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific Solaris data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_platform_limits_solaris.h

//===-- sanitizer_platform_limits_solaris.h -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer common code.
//
// Sizes and layouts of platform-specific Solaris data structures.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_posix.cpp

//===-- sanitizer_posix.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries and implements POSIX-specific functions from
// sanitizer_posix.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_posix.h

//===-- sanitizer_posix.h -------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries and declares some useful POSIX-specific functions.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_POSIX_H
#define SANITIZER_POSIX_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_posix_libcdep.cpp

//===-- sanitizer_posix_libcdep.cpp ---------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries and implements libc-dependent POSIX-specific functions
// from sanitizer_libc.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_printf.cpp

//===-- sanitizer_printf.cpp ----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer.
//
// Internal printf function, used inside run-time libraries.
// We can't use libc printf because we intercept some of the functions used
// inside it.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps.h

//===-- sanitizer_procmaps.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer.
//
// Information about the process mappings.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_PROCMAPS_H
#define SANITIZER_PROCMAPS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps_bsd.cpp

//===-- sanitizer_procmaps_bsd.cpp ----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Information about the process mappings
// (FreeBSD and NetBSD-specific parts).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps_common.cpp

//===-- sanitizer_procmaps_common.cpp -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Information about the process mappings (common parts).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps_fuchsia.cpp

//===-- sanitizer_procmaps_fuchsia.cpp
//----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Information about the process mappings (Fuchsia-specific parts).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps_haiku.cpp

//===-- sanitizer_procmaps_haiku.cpp --------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Information about the process mappings
// (Haiku-specific parts).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps_linux.cpp

//===-- sanitizer_procmaps_linux.cpp --------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Information about the process mappings (Linux-specific parts).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps_mac.cpp

//===-- sanitizer_procmaps_mac.cpp ----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Information about the process mappings (Mac-specific parts).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_procmaps_solaris.cpp

//===-- sanitizer_procmaps_solaris.cpp ------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Information about the process mappings (Solaris-specific parts).
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_ptrauth.h

//===-- sanitizer_ptrauth.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_quarantine.h

//===-- sanitizer_quarantine.h ----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Memory quarantine for AddressSanitizer and potentially other tools.
// Quarantine caches some specified amount of memory in per-thread caches,
// then evicts to global FIFO queue. When the queue reaches specified threshold,
// oldest memory is recycled.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_range.cpp

//===-- sanitizer_range.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_range.h

//===-- sanitizer_range.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Contais Range and related utilities.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_redefine_builtins.h

//===-- sanitizer_redefine_builtins.h ---------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Redefine builtin functions to use internal versions. This is needed where
// compiler optimizations end up producing unwanted libcalls!
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_COMMON_NO_REDEFINE_BUILTINS
#  ifndef SANITIZER_REDEFINE_BUILTINS_H
#    define SANITIZER_REDEFINE_BUILTINS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_report_decorator.h

//===-- sanitizer_report_decorator.h ----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Tags to decorate the sanitizer reports.
// Currently supported tags:
//   * None.
//   * ANSI color sequences.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_ring_buffer.h

//===-- sanitizer_ring_buffer.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Simple ring buffer.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_RING_BUFFER_H
#define SANITIZER_RING_BUFFER_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_signal_interceptors.inc

//===-- sanitizer_signal_interceptors.inc -----------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Signal interceptors for sanitizers.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_solaris.cpp

//===-- sanitizer_solaris.cpp ---------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries and
// implements Solaris-specific functions.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_solaris.h

//===-- sanitizer_solaris.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is a part of Sanitizer runtime. It contains Solaris-specific
// definitions.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stack_store.cpp

//===-- sanitizer_stack_store.cpp -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stack_store.h

//===-- sanitizer_stack_store.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stackdepot.cpp

//===-- sanitizer_stackdepot.cpp ------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stackdepot.h

//===-- sanitizer_stackdepot.h ----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stackdepotbase.h

//===-- sanitizer_stackdepotbase.h ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementation of a mapping from arbitrary values to unique 32-bit
// identifiers.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stacktrace.cpp

//===-- sanitizer_stacktrace.cpp ------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stacktrace.h

//===-- sanitizer_stacktrace.h ----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_STACKTRACE_H
#define SANITIZER_STACKTRACE_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stacktrace_emscripten.cpp

//===-- sanitizer_stacktrace_emscripten.cc --------------------------------===//
//
//                     The LLVM Compiler Infrastructure
//
// This file is distributed under the University of Illinois Open Source
// License. See LICENSE.TXT for details.
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//
// Implementation of fast stack unwinding for Emscripten.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stacktrace_libcdep.cpp

//===-- sanitizer_stacktrace_libcdep.cpp ----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stacktrace_printer.cpp

//===-- sanitizer_common.cpp ----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizers' run-time libraries.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stacktrace_printer.h

//===-- sanitizer_stacktrace_printer.h --------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizers' run-time libraries.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_STACKTRACE_PRINTER_H
#define SANITIZER_STACKTRACE_PRINTER_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stacktrace_sparc.cpp

//===-- sanitizer_stacktrace_sparc.cpp ------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//
// Implementation of fast stack unwinding for Sparc.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld.h

//===-- sanitizer_stoptheworld.h --------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Defines the StopTheWorld function which suspends the execution of the current
// process and runs the user-supplied callback in the same address space.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_STOPTHEWORLD_H
#define SANITIZER_STOPTHEWORLD_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld_fuchsia.cpp

//===-- sanitizer_stoptheworld_fuchsia.cpp -------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===---------------------------------------------------------------------===//
//
// See sanitizer_stoptheworld.h for details.
//
//===---------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld_fuchsia.h

//===-- sanitizer_stoptheworld_fuchsia.h ------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld_linux_libcdep.cpp

//===-- sanitizer_stoptheworld_linux_libcdep.cpp --------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// See sanitizer_stoptheworld.h for details.
// This implementation was inspired by Markus Gutschke's linuxthreads.cc.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld_linux_libcdep.cpp

// Block the execution of TracerThread until after we have set ptrace
  // permissions.

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld_mac.cpp

//===-- sanitizer_stoptheworld_mac.cpp ------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// See sanitizer_stoptheworld.h for details.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld_netbsd_libcdep.cpp

//===-- sanitizer_stoptheworld_netbsd_libcdep.cpp -------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// See sanitizer_stoptheworld.h for details.
// This implementation was inspired by Markus Gutschke's linuxthreads.cc.
//
// This is a NetBSD variation of Linux stoptheworld implementation
// See sanitizer_stoptheworld_linux_libcdep.cpp for code comments.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_stoptheworld_win.cpp

//===-- sanitizer_stoptheworld_win.cpp ------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// See sanitizer_stoptheworld.h for details.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_suppressions.cpp

//===-- sanitizer_suppressions.cpp ----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Suppression parsing/matching code.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_suppressions.h

//===-- sanitizer_suppressions.h --------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Suppression parsing/matching code.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_SUPPRESSIONS_H
#define SANITIZER_SUPPRESSIONS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer.cpp

//===-- sanitizer_symbolizer.cpp ------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer.h

//===-- sanitizer_symbolizer.h ----------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Symbolizer is used by sanitizers to map instruction address to a location in
// source code at run-time. Symbolizer either uses __sanitizer_symbolize_*
// defined in the program, or (if they are missing) tries to find and
// launch "llvm-symbolizer" commandline tool in a separate process and
// communicate with it.
//
// Generally we should try to avoid calling system library functions during
// symbolization (and use their replacements from sanitizer_libc.h instead).
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_SYMBOLIZER_H
#define SANITIZER_SYMBOLIZER_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_emscripten.cpp

//===-- sanitizer_symbolizer_emscripten.cc --------------------------------===//
//
//                     The LLVM Compiler Infrastructure
//
// This file is distributed under the University of Illinois Open Source
// License. See LICENSE.TXT for details.
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
// Emscripten-specific implementation of symbolizer parts.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_internal.h

//===-- sanitizer_symbolizer_internal.h -------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Header for internal classes and functions to be used by implementations of
// symbolizers.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_SYMBOLIZER_INTERNAL_H
#define SANITIZER_SYMBOLIZER_INTERNAL_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_libbacktrace.cpp

//===-- sanitizer_symbolizer_libbacktrace.cpp -----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
// Libbacktrace implementation of symbolizer parts.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_libbacktrace.h

//===-- sanitizer_symbolizer_libbacktrace.h ---------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
// Header for libbacktrace symbolizer.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_SYMBOLIZER_LIBBACKTRACE_H
#define SANITIZER_SYMBOLIZER_LIBBACKTRACE_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_libcdep.cpp

//===-- sanitizer_symbolizer_libcdep.cpp ----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_mac.cpp

//===-- sanitizer_symbolizer_mac.cpp --------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries.
//
// Implementation of Mac-specific "atos" symbolizer.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_mac.h

//===-- sanitizer_symbolizer_mac.h ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries.
//
// Header for Mac-specific "atos" symbolizer.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_markup.cpp

//===-- sanitizer_symbolizer_markup.cpp -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries.
//
// This generic support for offline symbolizing is based on the
// Fuchsia port.  We don't do any actual symbolization per se.
// Instead, we emit text containing raw addresses and raw linkage
// symbol names, embedded in Fuchsia's symbolization markup format.
// See the spec at:
// https://llvm.org/docs/SymbolizerMarkupFormat.html
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_markup.h

//===-- sanitizer_symbolizer_markup.h -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
//  This file is shared between various sanitizers' runtime libraries.
//
//  Header for the offline markup symbolizer.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_SYMBOLIZER_MARKUP_H
#define SANITIZER_SYMBOLIZER_MARKUP_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_markup_constants.h

//===-- sanitizer_symbolizer_markup_constants.h
//-----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries.
//
// Define string formats and limits for the markup symbolizer.
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_SYMBOLIZER_MARKUP_CONSTANTS_H
#define SANITIZER_SYMBOLIZER_MARKUP_CONSTANTS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_markup_fuchsia.cpp

//===-- sanitizer_symbolizer_markup_fuchsia.cpp ---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between various sanitizers' runtime libraries.
//
// Fuchsia specific implementation of offline markup symbolizer.
//===----------------------------------------------------------------------===//
#include "sanitizer_platform.h"

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_posix_libcdep.cpp

//===-- sanitizer_symbolizer_posix_libcdep.cpp ----------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
// POSIX-specific implementation of symbolizer parts.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_report.cpp

//===-- sanitizer_symbolizer_report.cpp -----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
///
/// This file is shared between AddressSanitizer and other sanitizer run-time
/// libraries and implements symbolized reports related functions.
///
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_report_fuchsia.cpp

//===-- sanitizer_symbolizer_report_fuchsia.cpp
//-----------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementation of the report functions for fuchsia.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_symbolizer_win.cpp

//===-- sanitizer_symbolizer_win.cpp --------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries.
// Windows-specific implementation of symbolizer parts.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscall_generic.inc

//===-- sanitizer_syscall_generic.inc ---------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Generic implementations of internal_syscall* and internal_iserror.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscall_linux_aarch64.inc

//===-- sanitizer_syscall_linux_aarch64.inc --------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementations of internal_syscall and internal_iserror for Linux/aarch64.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscall_linux_arm.inc

//===-- sanitizer_syscall_linux_arm.inc -------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementations of internal_syscall and internal_iserror for Linux/arm.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscall_linux_hexagon.inc

//===-- sanitizer_syscall_linux_hexagon.inc ---------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementations of internal_syscall and internal_iserror for Linux/hexagon.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscall_linux_loongarch64.inc

//===-- sanitizer_syscall_linux_loongarch64.inc -----------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementations of internal_syscall and internal_iserror for
// Linux/loongarch64.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscall_linux_riscv64.inc

//===-- sanitizer_syscall_linux_riscv64.inc ---------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementations of internal_syscall and internal_iserror for Linux/riscv64.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscall_linux_x86_64.inc

//===-- sanitizer_syscall_linux_x86_64.inc ----------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementations of internal_syscall and internal_iserror for Linux/x86_64.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_syscalls_netbsd.inc

//===-- sanitizer_syscalls_netbsd.inc ---------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common syscalls handlers for tools like AddressSanitizer,
// ThreadSanitizer, MemorySanitizer, etc.
//
// This file should be included into the tool's interceptor file,
// which has to define it's own macros:
//   COMMON_SYSCALL_PRE_READ_RANGE
//          Called in prehook for regions that will be read by the kernel and
//          must be initialized.
//   COMMON_SYSCALL_PRE_WRITE_RANGE
//          Called in prehook for regions that will be written to by the kernel
//          and must be addressable. The actual write range may be smaller than
//          reported in the prehook. See POST_WRITE_RANGE.
//   COMMON_SYSCALL_POST_READ_RANGE
//          Called in posthook for regions that were read by the kernel. Does
//          not make much sense.
//   COMMON_SYSCALL_POST_WRITE_RANGE
//          Called in posthook for regions that were written to by the kernel
//          and are now initialized.
//   COMMON_SYSCALL_ACQUIRE(addr)
//          Acquire memory visibility from addr.
//   COMMON_SYSCALL_RELEASE(addr)
//          Release memory visibility to addr.
//   COMMON_SYSCALL_FD_CLOSE(fd)
//          Called before closing file descriptor fd.
//   COMMON_SYSCALL_FD_ACQUIRE(fd)
//          Acquire memory visibility from fd.
//   COMMON_SYSCALL_FD_RELEASE(fd)
//          Release memory visibility to fd.
//   COMMON_SYSCALL_PRE_FORK()
//          Called before fork syscall.
//   COMMON_SYSCALL_POST_FORK(long long res)
//          Called after fork syscall.
//
// DO NOT EDIT! THIS FILE HAS BEEN GENERATED!
//
// Generated with: generate_netbsd_syscalls.awk
// Generated date: 2020-09-10
// Generated from: syscalls.master,v 1.306 2020/08/14 00:53:16 riastradh Exp
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_termination.cpp

//===-- sanitizer_termination.cpp -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
///
/// This file contains the Sanitizer termination functions CheckFailed and Die,
/// and the callback functionalities associated with them.
///
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_thread_arg_retval.cpp

//===-- sanitizer_thread_arg_retval.cpp -------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizer tools.
//
// Tracks thread arguments and return value for leak checking.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_thread_arg_retval.h

//===-- sanitizer_thread_arg_retval.h ---------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizer tools.
//
// Tracks thread arguments and return value for leak checking.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_thread_history.cpp

//===-- sanitizer_thread_history.cpp --------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_thread_history.h

//===-- sanitizer_thread_history.h ------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Utility to print thread histroy from ThreadRegistry.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_thread_registry.cpp

//===-- sanitizer_thread_registry.cpp -------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizer tools.
//
// General thread bookkeeping functionality.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_thread_registry.h

//===-- sanitizer_thread_registry.h -----------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizer tools.
//
// General thread bookkeeping functionality.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_thread_safety.h

//===-- sanitizer_thread_safety.h -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizer tools.
//
// Wrappers around thread safety annotations.
// https://clang.llvm.org/docs/ThreadSafetyAnalysis.html
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_tls_get_addr.cpp

//===-- sanitizer_tls_get_addr.cpp ----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Handle the __tls_get_addr call.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_tls_get_addr.h

//===-- sanitizer_tls_get_addr.h --------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Handle the __tls_get_addr call.
//
// All this magic is specific to glibc and is required to workaround
// the lack of interface that would tell us about the Dynamic TLS (DTLS).
// https://sourceware.org/bugzilla/show_bug.cgi?id=16291
//
// Before 2.25: every DTLS chunk is allocated with __libc_memalign,
// which we intercept and thus know where is the DTLS.
//
// Since 2.25: DTLS chunks are allocated with malloc. We could co-opt
// the malloc interceptor to keep track of the last allocation, similar
// to how we handle __libc_memalign; however, this adds some overhead
// (since malloc, unlike __libc_memalign, is commonly called), and
// requires care to avoid false negatives for LeakSanitizer.
// Instead, we rely on our internal allocators - which keep track of all
// its allocations - to determine if an address points to a malloc
// allocation.
//
// There exists a since-deprecated version of Google's internal glibc fork
// that used __signal_safe_memalign. DTLS_on_tls_get_addr relied on a
// heuristic check (is the allocation 16 bytes from the start of a page
// boundary?), which was sometimes erroneous:
//     https://bugs.chromium.org/p/chromium/issues/detail?id=1275223#c15
// Since that check has no practical use anymore, we have removed it.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_type_traits.cpp

//===-- sanitizer_type_traits.cpp -------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implements a subset of C++ type traits. This is so we can avoid depending
// on system C++ headers.
//
//===----------------------------------------------------------------------===//
#include "sanitizer_type_traits.h"

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_type_traits.h

//===-- sanitizer_type_traits.h ---------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implements a subset of C++ type traits. This is so we can avoid depending
// on system C++ headers.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_TYPE_TRAITS_H
#define SANITIZER_TYPE_TRAITS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_unwind_fuchsia.cpp

//===------------------ sanitizer_unwind_fuchsia.cpp
//---------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
/// Sanitizer unwind Fuchsia specific functions.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_unwind_linux_libcdep.cpp

//===-- sanitizer_unwind_linux_libcdep.cpp --------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file contains the unwind.h-based (aka "slow") stack unwinding routines
// available to the tools on Linux, Android, NetBSD, FreeBSD, and Solaris.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_unwind_win.cpp

//===-- sanitizer_unwind_win.cpp ------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
/// Sanitizer unwind Windows specific functions.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_vector.h

//===-- sanitizer_vector.h -------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between sanitizers run-time libraries.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win.cpp

//===-- sanitizer_win.cpp -------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer and ThreadSanitizer
// run-time libraries and implements windows-specific functions from
// sanitizer_libc.h.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win.h

//===-- sanitizer_win.h -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Windows-specific declarations.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_WIN_H
#define SANITIZER_WIN_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win_defs.h

//===-- sanitizer_win_defs.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Common definitions for Windows-specific code.
//
//===----------------------------------------------------------------------===//
#ifndef SANITIZER_WIN_DEFS_H
#define SANITIZER_WIN_DEFS_H

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win_immortalize.h

//===-- sanitizer_win_immortalize.h ---------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file is shared between AddressSanitizer, and interception.
//
// Windows-specific thread-safe and pre-CRT global initialization safe
// infrastructure to create an object whose destructor is never called.
//===----------------------------------------------------------------------===//
#if SANITIZER_WINDOWS
#  pragma once
// Requires including sanitizer_placement_new.h (which is not allowed to be
// included in headers).

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win_interception.cpp

//===-- sanitizer_win_interception.cpp --------------------    --*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Windows-specific export surface to provide interception for parts of the
// runtime that are always statically linked, both for overriding user-defined
// functions as well as registering weak functions that the ASAN runtime should
// use over defaults.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win_interception.h

//===-- sanitizer_win_interception.h ----------------------    --*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Windows-specific export surface to provide interception for parts of the
// runtime that are always statically linked, both for overriding user-defined
// functions as well as registering weak functions that the ASAN runtime should
// use over defaults.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win_thunk_interception.cpp

//===-- sanitizer_win_thunk_interception.cpp -----------------------  -----===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file defines things that need to be present in the application modules
// to interact with sanitizer DLL correctly and cannot be implemented using the
// default "import library" generated when linking the DLL.
//
// This includes the common infrastructure required to intercept local functions
// that must be replaced with sanitizer-aware versions, as well as the
// registration of weak functions with the sanitizer DLL. With this in-place,
// other sanitizer components can simply write to the .INTR and .WEAK sections.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/sanitizer_common/sanitizer_win_thunk_interception.h

//===-- sanitizer_win_thunk_interception.h -------------------------  -----===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
// This header provide helper macros and functions to delegate calls to the
// shared runtime that lives in the sanitizer DLL.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_checks.inc

//===-- ubsan_checks.inc ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// List of checks handled by UBSan runtime.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_CHECK
# error "Define UBSAN_CHECK prior to including this file!"
#endif

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_diag.cpp

//===-- ubsan_diag.cpp ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Diagnostic reporting for the UBSan runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_diag.h

//===-- ubsan_diag.h --------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Diagnostics emission for Clang's undefined behavior sanitizer.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_DIAG_H
#define UBSAN_DIAG_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_diag_standalone.cpp

//===-- ubsan_diag_standalone.cpp -----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Diagnostic reporting for the standalone UBSan runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_flags.cpp

//===-- ubsan_flags.cpp ---------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Runtime flags for UndefinedBehaviorSanitizer.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_flags.h

//===-- ubsan_flags.h -------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Runtime flags for UndefinedBehaviorSanitizer.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_FLAGS_H
#define UBSAN_FLAGS_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_flags.inc

//===-- ubsan_flags.inc -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// UBSan runtime flags.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_FLAG
# error "Define UBSAN_FLAG prior to including this file!"
#endif

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_handlers.cpp

//===-- ubsan_handlers.cpp ------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Error logging entry points for the UBSan runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_handlers.h

//===-- ubsan_handlers.h ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Entry points to the runtime library for Clang's undefined behavior sanitizer.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_HANDLERS_H
#define UBSAN_HANDLERS_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_handlers_cxx.cpp

//===-- ubsan_handlers_cxx.cpp --------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Error logging entry points for the UBSan runtime, which are only used for C++
// compilations. This file is permitted to use language features which require
// linking against a C++ ABI library.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_handlers_cxx.h

//===-- ubsan_handlers_cxx.h ------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Entry points to the runtime library for Clang's undefined behavior sanitizer,
// for C++-specific checks. This code is not linked into C binaries.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_HANDLERS_CXX_H
#define UBSAN_HANDLERS_CXX_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_init.cpp

//===-- ubsan_init.cpp ----------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Initialization of UBSan runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_init.h

//===-- ubsan_init.h --------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Initialization function for UBSan runtime.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_INIT_H
#define UBSAN_INIT_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_init_standalone.cpp

//===-- ubsan_init_standalone.cpp -----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Initialization of standalone UBSan runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_init_standalone_preinit.cpp

//===-- ubsan_init_standalone_preinit.cpp --------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Initialization of standalone UBSan runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_interface.inc

//===-- ubsan_interface.inc -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
// Ubsan interface list.
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_monitor.cpp

//===-- ubsan_monitor.cpp ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Hooks which allow a monitor process to inspect UBSan's diagnostics.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_monitor.h

//===-- ubsan_monitor.h -----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Hooks which allow a monitor process to inspect UBSan's diagnostics.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_platform.h

//===-- ubsan_platform.h ----------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Defines the platforms which UBSan is supported at.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_PLATFORM_H
#define UBSAN_PLATFORM_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_signals_standalone.cpp

//=-- ubsan_signals_standalone.cpp ----------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Installs signal handlers and related interceptors for UBSan standalone.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_signals_standalone.h

//=-- ubsan_signals_standalone.h
//------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Installs signal handlers and related interceptors for UBSan standalone.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_type_hash.cpp

//===-- ubsan_type_hash.cpp -----------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementation of a hash table for fast checking of inheritance
// relationships. This file is only linked into C++ compilations, and is
// permitted to use language features which require a C++ ABI library.
//
// Most of the implementation lives in an ABI-specific source file
// (ubsan_type_hash_{itanium,win}.cpp).
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_type_hash.h

//===-- ubsan_type_hash.h ---------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Hashing of types for Clang's undefined behavior checker.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_TYPE_HASH_H
#define UBSAN_TYPE_HASH_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_type_hash_itanium.cpp

//===-- ubsan_type_hash_itanium.cpp ---------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementation of type hashing/lookup for Itanium C++ ABI.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_type_hash_win.cpp

//===-- ubsan_type_hash_win.cpp -------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Implementation of type hashing/lookup for Microsoft C++ ABI.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_value.cpp

//===-- ubsan_value.cpp ---------------------------------------------------===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Representation of a runtime value, as marshaled from the generated code to
// the ubsan runtime.
//
//===----------------------------------------------------------------------===//

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_value.h

//===-- ubsan_value.h -------------------------------------------*- C++ -*-===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// Representation of data which is passed from the compiler-generated calls into
// the ubsan runtime.
//
//===----------------------------------------------------------------------===//
#ifndef UBSAN_VALUE_H
#define UBSAN_VALUE_H

Source(s): system/lib/compiler-rt/lib/ubsan/ubsan_win_runtime_thunk.cpp

//===-- ubsan_win_runtime_thunk.cpp -----------------------------        --===//
//
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
//===----------------------------------------------------------------------===//
//
// This file defines things that need to be present in the application modules
// to interact with Ubsan, when it is included in a dll.
//
//===----------------------------------------------------------------------===//
#if defined(SANITIZER_DYNAMIC_RUNTIME_THUNK) ||                                \

Source(s): system/lib/emmalloc.c

/*
 * Copyright 2018 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Simple minimalistic but efficient sbrk()-based malloc/free that works in
 * singlethreaded and multithreaded builds.
 *
 * Assumptions:
 *
 *  - sbrk() is used to claim new memory (sbrk handles geometric/linear
 *  - overallocation growth)
 *  - sbrk() can also be called by other code, not reserved to emmalloc only.
 *  - sbrk() is very fast in most cases (internal wasm call).
 *  - sbrk() returns pointers with an alignment of alignof(max_align_t)
 *
 * Invariants:
 *
 *  - Per-allocation header overhead is 8 bytes, smallest allocated payload
 *    amount is 8 bytes, and a multiple of 4 bytes.
 *  - Acquired memory blocks are subdivided into disjoint regions that lie
 *    next to each other.
 *  - A region is either in use or free.
 *    Used regions may be adjacent, and a used and unused region
 *    may be adjacent, but not two unused ones - they would be
 *    merged.
 *  - Memory allocation takes constant time, unless the alloc needs to sbrk()
 *    or memory is very close to being exhausted.
 *  - Free and used regions are managed inside "root regions", which are slabs
 *    of memory acquired via calls to sbrk().
 *
 * Debugging:
 *
 *  - If not NDEBUG, runtime assert()s are in use.
 *  - If EMMALLOC_MEMVALIDATE is defined, a large amount of extra checks are done.
 *  - If EMMALLOC_VERBOSE is defined, a lot of operations are logged using
 *    `out`, in addition to EMMALLOC_MEMVALIDATE.
 *  - Debugging and logging directly uses `out` and `err` via EM_ASM, not
 *    printf etc., to minimize any risk of debugging or logging depending on
 *    malloc.
 *
 * Exporting:
 *
 *  - By default we declare not only emmalloc_malloc, emmalloc_free, etc. but
 *    also the standard library methods like malloc, free, and some aliases.
 *    You can override this by defining EMMALLOC_NO_STD_EXPORTS, in which case
 *    we only declare the emalloc_* ones but not the standard ones.
 */

Source(s): system/lib/libc/dynlink.c

/*
 * Copyright 2021 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Emscripten-specific version dlopen and associated functions.  Some code is
 * shared with musl's ldso/dynlink.c.
 */

Source(s): system/lib/libc/emscripten_fiber.c

// Copyright 2022 The Emscripten Authors.  All rights reserved.
// Emscripten is available under two separate licenses, the MIT license and the
// University of Illinois/NCSA Open Source License.  Both these licenses can be
// found in the LICENSE file.

Source(s): system/lib/libc/emscripten_internal.h

/*
 * Copyright 2023 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Declarations for internal-only JS library functions.
 *
 * All JS library functions must be declares in one header or anther in order
 * for `tools/maint/gen_sig_info.py` to work.   This file contains declarations for
 * functions that are not declared in any other public or private header.
 */

Source(s): system/lib/libc/emscripten_libc_stubs.c

/*
 * Copyright 2021 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Fake/stub implementations of libc functions.
 * See emscripten_syscall_stubs.c for fake/stub implementations of syscalls.
 */

Source(s): system/lib/libc/emscripten_syscall_stubs.c

/*
 * Copyright 2021 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
 * Unimplemented/dummy syscall implementations. These fall into 3 categories.
 *
 * 1. Fake it, use dummy/placeholder values and return success.
 * 2. Fake it, as above but warn at runtime if called.
 * 3. Return ENOSYS and warn at runtime if called.
 */

Source(s): system/lib/libc/musl/COPYRIGHT

musl as a whole is licensed under the following standard MIT license:

----------------------------------------------------------------------
Copyright © 2005-2020 Rich Felker, et al.

Permission is hereby granted, free of charge, to any person obtaining
a copy of this software and associated documentation files (the
"Software"), to deal in the Software without restriction, including
without limitation the rights to use, copy, modify, merge, publish,
distribute, sublicense, and/or sell copies of the Software, and to
permit persons to whom the Software is furnished to do so, subject to
the following conditions:

The above copyright notice and this permission notice shall be
included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
----------------------------------------------------------------------

Authors/contributors include:

A. Wilcox
Ada Worcester
Alex Dowad
Alex Suykov
Alexander Monakov
Andre McCurdy
Andrew Kelley
Anthony G. Basile
Aric Belsito
Arvid Picciani
Bartosz Brachaczek
Benjamin Peterson
Bobby Bingham
Boris Brezillon
Brent Cook
Chris Spiegel
Clément Vasseur
Daniel Micay
Daniel Sabogal
Daurnimator
David Carlier
David Edelsohn
Denys Vlasenko
Dmitry Ivanov
Dmitry V. Levin
Drew DeVault
Emil Renner Berthing
Fangrui Song
Felix Fietkau
Felix Janda
Gianluca Anzolin
Hauke Mehrtens
He X
Hiltjo Posthuma
Isaac Dunham
Jaydeep Patil
Jens Gustedt
Jeremy Huntwork
Jo-Philipp Wich
Joakim Sindholt
John Spencer
Julien Ramseier
Justin Cormack
Kaarle Ritvanen
Khem Raj
Kylie McClain
Leah Neukirchen
Luca Barbato
Luka Perkov
Lynn Ochs
M Farkas-Dyck (Strake)
Mahesh Bodapati
Markus Wichmann
Masanori Ogino
Michael Clark
Michael Forney
Mikhail Kremnyov
Natanael Copa
Nicholas J. Kain
orc
Pascal Cuoq
Patrick Oppenlander
Petr Hosek
Petr Skocik
Pierre Carrier
Reini Urban
Rich Felker
Richard Pennington
Ryan Fairfax
Samuel Holland
Segev Finer
Shiz
sin
Solar Designer
Stefan Kristiansson
Stefan O'Rear
Szabolcs Nagy
Timo Teräs
Trutz Behn
Will Dietz
William Haddon
William Pitcock

Portions of this software are derived from third-party works licensed
under terms compatible with the above MIT license:

The TRE regular expression implementation (src/regex/reg* and
src/regex/tre*) is Copyright © 2001-2008 Ville Laurikari and licensed
under a 2-clause BSD license (license text in the source files). The
included version has been heavily modified by Rich Felker in 2012, in
the interests of size, simplicity, and namespace cleanliness.

Much of the math library code (src/math/* and src/complex/*) is
Copyright © 1993,2004 Sun Microsystems or
Copyright © 2003-2011 David Schultz or
Copyright © 2003-2009 Steven G. Kargl or
Copyright © 2003-2009 Bruce D. Evans or
Copyright © 2008 Stephen L. Moshier or
Copyright © 2017-2018 Arm Limited
and labelled as such in comments in the individual source files. All
have been licensed under extremely permissive terms.

The ARM memcpy code (src/string/arm/memcpy.S) is Copyright © 2008
The Android Open Source Project and is licensed under a two-clause BSD
license. It was taken from Bionic libc, used on Android.

The AArch64 memcpy and memset code (src/string/aarch64/*) are
Copyright © 1999-2019, Arm Limited.

The implementation of DES for crypt (src/crypt/crypt_des.c) is
Copyright © 1994 David Burren. It is licensed under a BSD license.

The implementation of blowfish crypt (src/crypt/crypt_blowfish.c) was
originally written by Solar Designer and placed into the public
domain. The code also comes with a fallback permissive license for use
in jurisdictions that may not recognize the public domain.

The smoothsort implementation (src/stdlib/qsort.c) is Copyright © 2011
Lynn Ochs and is licensed under an MIT-style license.

The x86_64 port was written by Nicholas J. Kain and is licensed under
the standard MIT terms.

The mips and microblaze ports were originally written by Richard
Pennington for use in the ellcc project. The original code was adapted
by Rich Felker for build system and code conventions during upstream
integration. It is licensed under the standard MIT terms.

The mips64 port was contributed by Imagination Technologies and is
licensed under the standard MIT terms.

The powerpc port was also originally written by Richard Pennington,
and later supplemented and integrated by John Spencer. It is licensed
under the standard MIT terms.

All other files which have no copyright comments are original works
produced specifically for use as part of this library, written either
by Rich Felker, the main author of the library, or by one or more
contibutors listed above. Details on authorship of individual files
can be found in the git version control history of the project. The
omission of copyright and license comments in each file is in the
interest of source tree size.

In addition, permission is hereby granted for all public header files
(include/* and arch/*/bits/*) and crt files intended to be linked into
applications (crt/*, ldso/dlstart.c, and arch/*/crt_arch.h) to omit
the copyright notice and permission notice otherwise required by the
license, and to use these files without any requirement of
attribution. These files include substantial contributions from:

Bobby Bingham
John Spencer
Nicholas J. Kain
Rich Felker
Richard Pennington
Stefan Kristiansson
Szabolcs Nagy

all of whom have explicitly granted such permission.

This file previously contained text expressing a belief that most of
the files covered by the above exception were sufficiently trivial not
to be subject to copyright, resulting in confusion over whether it
negated the permissions granted in the license. In the spirit of
permissive licensing, and of not having licensing issues being an
obstacle to adoption, that text has been removed.

Source(s): system/lib/libc/musl/include/netinet/ip.h

#define	IPTOS_TOS_MASK		0x1E
#define	IPTOS_TOS(tos)		((tos) & IPTOS_TOS_MASK)
#define	IPTOS_LOWDELAY		0x10
#define	IPTOS_THROUGHPUT	0x08
#define	IPTOS_RELIABILITY	0x04
#define	IPTOS_LOWCOST		0x02
#define	IPTOS_MINCOST		IPTOS_LOWCOST

Source(s): system/lib/libc/musl/src/complex/__cexp.c, system/lib/libc/musl/src/complex/__cexpf.c, system/lib/libc/musl/src/complex/cexp.c, system/lib/libc/musl/src/complex/cexpf.c

/*-
 * Copyright (c) 2011 David Schultz <das@FreeBSD.ORG>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

Source(s): system/lib/libc/musl/src/complex/catan.c, system/lib/libc/musl/src/complex/catanf.c, system/lib/libc/musl/src/complex/catanl.c, system/lib/libc/musl/src/math/__polevll.c, system/lib/libc/musl/src/math/erfl.c, system/lib/libc/musl/src/math/expl.c, system/lib/libc/musl/src/math/expm1l.c, system/lib/libc/musl/src/math/lgammal.c, system/lib/libc/musl/src/math/log10l.c, system/lib/libc/musl/src/math/log1pl.c, system/lib/libc/musl/src/math/log2l.c, system/lib/libc/musl/src/math/logl.c, system/lib/libc/musl/src/math/powl.c, system/lib/libc/musl/src/math/tgammal.c

/*
 * Copyright (c) 2008 Stephen L. Moshier <steve@moshier.net>
 *
 * Permission to use, copy, modify, and distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
 * ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN
 * ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF
 * OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

Source(s): system/lib/libc/musl/src/complex/ccosh.c, system/lib/libc/musl/src/complex/ccoshf.c, system/lib/libc/musl/src/complex/csinh.c, system/lib/libc/musl/src/complex/csinhf.c

/*-
 * Copyright (c) 2005 Bruce D. Evans and Steven G. Kargl
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice unmodified, this list of conditions, and the following
 *    disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 * IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

Source(s): system/lib/libc/musl/src/complex/csqrt.c, system/lib/libc/musl/src/complex/csqrtf.c

/*-
 * Copyright (c) 2007 David Schultz <das@FreeBSD.ORG>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

Source(s): system/lib/libc/musl/src/complex/ctanh.c, system/lib/libc/musl/src/complex/ctanhf.c

/*-
 * Copyright (c) 2011 David Schultz
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice unmodified, this list of conditions, and the following
 *    disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR ``AS IS'' AND ANY EXPRESS OR
 * IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES
 * OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED.
 * IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY DIRECT, INDIRECT,
 * INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT
 * NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
 * DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
 * THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
 * (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF
 * THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 */

Source(s): system/lib/libc/musl/src/crypt/crypt_blowfish.c

/*
 * The crypt_blowfish homepage is:
 *
 *	http://www.openwall.com/crypt/
 *
 * This code comes from John the Ripper password cracker, with reentrant
 * and crypt(3) interfaces added, but optimizations specific to password
 * cracking removed.
 *
 * Written by Solar Designer <solar at openwall.com> in 1998-2012.
 * No copyright is claimed, and the software is hereby placed in the public
 * domain.  In case this attempt to disclaim copyright and place the software
 * in the public domain is deemed null and void, then the software is
 * Copyright (c) 1998-2014 Solar Designer and it is hereby released to the
 * general public under the following terms:
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted.
 *
 * There's ABSOLUTELY NO WARRANTY, express or implied.
 *
 * It is my intent that you should be able to use this on your system,
 * as part of a software package, or anywhere else to improve security,
 * ensure compatibility, or for any other purpose.  I would appreciate
 * it if you give credit where it is due and keep your modifications in
 * the public domain as well, but I don't require that in order to let
 * you place this code and any modifications you make under a license
 * of your choice.
 *
 * This implementation is fully compatible with OpenBSD's bcrypt.c for prefix
 * "$2b$", originally by Niels Provos <provos at citi.umich.edu>, and it uses
 * some of his ideas.  The password hashing algorithm was designed by David
 * Mazieres <dm at lcs.mit.edu>.  For information on the level of
 * compatibility for bcrypt hash prefixes other than "$2b$", please refer to
 * the comments in BF_set_key() below and to the included crypt(3) man page.
 *
 * There's a paper on the algorithm that explains its design decisions:
 *
 *	http://www.usenix.org/events/usenix99/provos.html
 *
 * Some of the tricks in BF_ROUND might be inspired by Eric Young's
 * Blowfish library (I can't be sure if I would think of something if I
 * hadn't seen his code).
 */

Source(s): system/lib/libc/musl/src/crypt/crypt_des.c

/*
 * FreeSec: libcrypt for NetBSD
 *
 * Copyright (c) 1994 David Burren
 * Copyright (c) 2000,2002,2010,2012 Solar Designer
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 * 3. Neither the name of the author nor the names of other contributors
 *    may be used to endorse or promote products derived from this software
 *    without specific prior written permission.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 *
 *	$Owl: Owl/packages/glibc/crypt_freesec.c,v 1.6 2010/02/20 14:45:06 solar Exp $
 *	$Id: crypt.c,v 1.15 1994/09/13 04:58:49 davidb Exp $
 *
 * This is an original implementation of the DES and the crypt(3) interfaces
 * by David Burren.  It has been heavily re-worked by Solar Designer.
 */

Source(s): system/lib/libc/musl/src/crypt/crypt_md5.c

/* public domain md5 implementation based on rfc1321 and libtomcrypt */

Source(s): system/lib/libc/musl/src/crypt/crypt_md5.c

/*-
 * Copyright (c) 2003 Poul-Henning Kamp
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

Source(s): system/lib/libc/musl/src/crypt/crypt_sha256.c

/*
 * public domain sha256 crypt implementation
 *
 * original sha crypt design: http://people.redhat.com/drepper/SHA-crypt.txt
 * in this implementation at least 32bit int is assumed,
 * key length is limited, the $5$ prefix is mandatory, '\n' and ':' is rejected
 * in the salt and rounds= setting must contain a valid iteration count,
 * on error "*" is returned.
 */

Source(s): system/lib/libc/musl/src/crypt/crypt_sha256.c

/* public domain sha256 implementation based on fips180-3 */

Source(s): system/lib/libc/musl/src/crypt/crypt_sha512.c

/*
 * public domain sha512 crypt implementation
 *
 * original sha crypt design: http://people.redhat.com/drepper/SHA-crypt.txt
 * in this implementation at least 32bit int is assumed,
 * key length is limited, the $6$ prefix is mandatory, '\n' and ':' is rejected
 * in the salt and rounds= setting must contain a valid iteration count,
 * on error "*" is returned.
 */

Source(s): system/lib/libc/musl/src/crypt/crypt_sha512.c

/* public domain sha512 implementation based on fips180-3 */

Source(s): system/lib/libc/musl/src/math/__cos.c, system/lib/libc/musl/src/math/__rem_pio2_large.c, system/lib/libc/musl/src/math/__sin.c, system/lib/libc/musl/src/math/acos.c, system/lib/libc/musl/src/math/acosl.c, system/lib/libc/musl/src/math/asin.c, system/lib/libc/musl/src/math/asinl.c, system/lib/libc/musl/src/math/j0.c, system/lib/libc/musl/src/math/j1.c, system/lib/libc/musl/src/math/jn.c, system/lib/libc/musl/src/math/log10.c, system/lib/libc/musl/src/math/log2_small.c, system/lib/libc/musl/src/math/log_small.c, system/lib/libc/musl/src/math/scalb.c

/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

Source(s): system/lib/libc/musl/src/math/__cosdf.c, system/lib/libc/musl/src/math/__rem_pio2f.c, system/lib/libc/musl/src/math/__sindf.c, system/lib/libc/musl/src/math/acosf.c, system/lib/libc/musl/src/math/asinf.c, system/lib/libc/musl/src/math/atan.c, system/lib/libc/musl/src/math/atan2f.c, system/lib/libc/musl/src/math/atanf.c, system/lib/libc/musl/src/math/atanl.c, system/lib/libc/musl/src/math/cbrtf.c, system/lib/libc/musl/src/math/cos.c, system/lib/libc/musl/src/math/cosf.c, system/lib/libc/musl/src/math/erf.c, system/lib/libc/musl/src/math/erff.c, system/lib/libc/musl/src/math/erfl.c, system/lib/libc/musl/src/math/expm1.c, system/lib/libc/musl/src/math/expm1f.c, system/lib/libc/musl/src/math/j0f.c, system/lib/libc/musl/src/math/j1f.c, system/lib/libc/musl/src/math/jnf.c, system/lib/libc/musl/src/math/lgammaf_r.c, system/lib/libc/musl/src/math/lgammal.c, system/lib/libc/musl/src/math/log10f.c, system/lib/libc/musl/src/math/log1p.c, system/lib/libc/musl/src/math/log1pf.c, system/lib/libc/musl/src/math/scalbf.c, system/lib/libc/musl/src/math/sin.c, system/lib/libc/musl/src/math/sincos.c, system/lib/libc/musl/src/math/sincosf.c, system/lib/libc/musl/src/math/sinf.c, system/lib/libc/musl/src/math/tan.c, system/lib/libc/musl/src/math/tanf.c

/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

Source(s): system/lib/libc/musl/src/math/__cosl.c, system/lib/libc/musl/src/math/__sinl.c

/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Copyright (c) 2008 Steven G. Kargl, David Schultz, Bruce D. Evans.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

Source(s): system/lib/libc/musl/src/math/__rem_pio2.c

/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * Optimized by Bruce D. Evans.
 */

Source(s): system/lib/libc/musl/src/math/__rem_pio2l.c

/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Copyright (c) 2008 Steven G. Kargl, David Schultz, Bruce D. Evans.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * Optimized by Bruce D. Evans.
 */

Source(s): system/lib/libc/musl/src/math/__tan.c, system/lib/libc/musl/src/math/__tandf.c

/*
 * ====================================================
 * Copyright 2004 Sun Microsystems, Inc.  All Rights Reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

Source(s): system/lib/libc/musl/src/math/__tanl.c

/*
 * ====================================================
 * Copyright 2004 Sun Microsystems, Inc.  All Rights Reserved.
 * Copyright (c) 2008 Steven G. Kargl, David Schultz, Bruce D. Evans.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

Source(s): system/lib/libc/musl/src/math/atan2.c, system/lib/libc/musl/src/math/atan2l.c, system/lib/libc/musl/src/math/lgamma_r.c

/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunSoft, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 */

Source(s): system/lib/libc/musl/src/math/cbrt.c

/*
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 *
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * Optimized by Bruce D. Evans.
 */

Source(s): system/lib/libc/musl/src/math/cbrtl.c

/*-
 * ====================================================
 * Copyright (C) 1993 by Sun Microsystems, Inc. All rights reserved.
 * Copyright (c) 2009-2011, Bruce D. Evans, Steven G. Kargl, David Schultz.
 *
 * Developed at SunPro, a Sun Microsystems, Inc. business.
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 *
 * The argument reduction and testing for exceptional cases was
 * written by Steven G. Kargl with input from Bruce D. Evans
 * and David A. Schultz.
 */

Source(s): system/lib/libc/musl/src/math/exp.c

/*
 * Double-precision e^x function.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/exp2.c

/*
 * Double-precision 2^x function.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/exp2f.c

/*
 * Single-precision 2^x function.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/exp2f_data.c

/*
 * Shared data between expf, exp2f and powf.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/exp2f_data.h, system/lib/libc/musl/src/math/log2f_data.h, system/lib/libc/musl/src/math/logf_data.h, system/lib/libc/musl/src/math/powf.c, system/lib/libc/musl/src/math/powf_data.h

/*
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/exp2l.c

/*-
 * Copyright (c) 2005-2008 David Schultz <das@FreeBSD.ORG>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

Source(s): system/lib/libc/musl/src/math/exp_data.c

/*
 * Shared data between exp, exp2 and pow.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/exp_data.h, system/lib/libc/musl/src/math/log2_data.h, system/lib/libc/musl/src/math/log_data.h, system/lib/libc/musl/src/math/pow_data.h

/*
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/expf.c

/*
 * Single-precision e^x function.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/fmaf.c, system/lib/libc/musl/src/math/fmal.c

/*-
 * Copyright (c) 2005-2011 David Schultz <das@FreeBSD.ORG>
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE AUTHOR AND CONTRIBUTORS ``AS IS'' AND
 * ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 * IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 * ARE DISCLAIMED.  IN NO EVENT SHALL THE AUTHOR OR CONTRIBUTORS BE LIABLE
 * FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
 * DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS
 * OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
 * LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY
 * OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF
 * SUCH DAMAGE.
 */

Source(s): system/lib/libc/musl/src/math/log.c

/*
 * Double-precision log(x) function.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/log2.c

/*
 * Double-precision log2(x) function.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/log2_data.c

/*
 * Data for log2.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/log2f.c

/*
 * Single-precision log2 function.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/log2f_data.c

/*
 * Data definition for log2f.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/log_data.c

/*
 * Data for log.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/logf.c

/*
 * Single-precision log function.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/logf_data.c

/*
 * Data definition for logf.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/pow.c

/*
 * Double-precision x^y function.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/pow_data.c

/*
 * Data for the log part of pow.
 *
 * Copyright (c) 2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/math/pow_small.c

/*
 * ====================================================
 * Copyright (C) 2004 by Sun Microsystems, Inc. All rights reserved.
 *
 * Permission to use, copy, modify, and distribute this
 * software is freely granted, provided that this notice
 * is preserved.
 * ====================================================
 */

Source(s): system/lib/libc/musl/src/math/powf_data.c

/*
 * Data definition for powf.
 *
 * Copyright (c) 2017-2018, Arm Limited.
 * SPDX-License-Identifier: MIT
 */

Source(s): system/lib/libc/musl/src/misc/fmtmsg.c

/* Public domain fmtmsg()
 * Written by Isaac Dunham, 2014
 */

Source(s): system/lib/libc/musl/src/regex/regcomp.c

/*
  regcomp.c - TRE POSIX compatible regex compilation functions.

  Copyright (c) 2001-2009 Ville Laurikari <vl@iki.fi>
  All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

    1. Redistributions of source code must retain the above copyright
       notice, this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER AND CONTRIBUTORS
  ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
  HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

Source(s): system/lib/libc/musl/src/regex/regexec.c

/*
  regexec.c - TRE POSIX compatible matching functions (and more).

  Copyright (c) 2001-2009 Ville Laurikari <vl@iki.fi>
  All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

    1. Redistributions of source code must retain the above copyright
       notice, this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER AND CONTRIBUTORS
  ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
  HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

Source(s): system/lib/libc/musl/src/regex/tre-mem.c

/*
  tre-mem.c - TRE memory allocator

  Copyright (c) 2001-2009 Ville Laurikari <vl@iki.fi>
  All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

    1. Redistributions of source code must retain the above copyright
       notice, this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER AND CONTRIBUTORS
  ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
  HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

Source(s): system/lib/libc/musl/src/regex/tre.h

/*
  tre-internal.h - TRE internal definitions

  Copyright (c) 2001-2009 Ville Laurikari <vl@iki.fi>
  All rights reserved.

  Redistribution and use in source and binary forms, with or without
  modification, are permitted provided that the following conditions
  are met:

    1. Redistributions of source code must retain the above copyright
       notice, this list of conditions and the following disclaimer.

    2. Redistributions in binary form must reproduce the above copyright
       notice, this list of conditions and the following disclaimer in the
       documentation and/or other materials provided with the distribution.

  THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDER AND CONTRIBUTORS
  ``AS IS'' AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
  LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
  A PARTICULAR PURPOSE ARE DISCLAIMED.  IN NO EVENT SHALL THE COPYRIGHT
  HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
  SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
  LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
  DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
  THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
  (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
  OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

*/

Source(s): system/lib/libc/musl/src/stdio/setvbuf.c

/* The behavior of this function is undefined except when it is the first
 * operation on the stream, so the presence or absence of locking is not
 * observable in a program whose behavior is defined. Thus no locking is
 * performed here. No allocation of buffers is performed, but a buffer
 * provided by the caller is used as long as it is suitably sized. */

Source(s): system/lib/libc/musl/src/stdlib/qsort.c

/* Copyright (C) 2011 by Lynn Ochs
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to
 * deal in the Software without restriction, including without limitation the
 * rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
 * sell copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
 * IN THE SOFTWARE.
 */

Source(s): system/lib/libc/sbrk.c

/*
 * Copyright 2019 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 *
*/


===== Actual LLVM83ee license and exceptions =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-first-pinned-build-author-sol/notice-supplement/actual-LLVM-LICENSE.TXT
SHA256: 8d85c1057d742e597985c7d4e6320b015a9139385cff4cbae06ffc0ebe89afee

==============================================================================
The LLVM Project is under the Apache License v2.0 with LLVM Exceptions:
==============================================================================

                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

    TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

    1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

    2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

    3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

    4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

    5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

    6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

    7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

    8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

    9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

    END OF TERMS AND CONDITIONS

    APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

    Copyright [yyyy] [name of copyright owner]

    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.


---- LLVM Exceptions to the Apache 2.0 License ----

As an exception, if, as a result of your compiling your source code, portions
of this Software are embedded into an Object form of such source code, you
may redistribute such embedded portions in such Object form without complying
with the conditions of Sections 4(a), 4(b) and 4(d) of the License.

In addition, if you combine or link compiled forms of this Software with
software that is licensed under the GPLv2 ("Combined Software") and if a
court of competent jurisdiction determines that the patent provision (Section
3), the indemnity provision (Section 9) or other Section of the License
conflicts with the conditions of the GPLv2, you may retroactively and
prospectively choose to deem waived or otherwise exclude such Section(s) of
the License, but only in their entirety and only with respect to the Combined
Software.

==============================================================================
Software from third parties included in the LLVM Project:
==============================================================================
The LLVM Project contains third party software which is under different license
terms. All such code will be identified clearly using at least one of two
mechanisms:
1) It will be in a separate directory tree with its own `LICENSE.txt` or
   `LICENSE` file at the top containing the specific license and restrictions
   which apply to that software, or
2) It will contain specific license and restriction terms at the top of every
   file.

==============================================================================
Legacy LLVM License (https://llvm.org/docs/DeveloperPolicy.html#legacy):
==============================================================================
University of Illinois/NCSA
Open Source License

Copyright (c) 2003-2019 University of Illinois at Urbana-Champaign.
All rights reserved.

Developed by:

    LLVM Team

    University of Illinois at Urbana-Champaign

    http://llvm.org

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal with
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

    * Redistributions of source code must retain the above copyright notice,
      this list of conditions and the following disclaimers.

    * Redistributions in binary form must reproduce the above copyright notice,
      this list of conditions and the following disclaimers in the
      documentation and/or other materials provided with the distribution.

    * Neither the names of the LLVM Team, University of Illinois at
      Urbana-Champaign, nor the names of its contributors may be used to
      endorse or promote products derived from this Software without specific
      prior written permission.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.  IN NO EVENT SHALL THE
CONTRIBUTORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS WITH THE
SOFTWARE.



===== Observed pthread-source notices =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-first-pinned-build-author-sol/notice-supplement/pthread-notices.txt
SHA256: 2b1a5f7eb62f38495d685025f434f99a3cf2cf6bd5a5130938817a365d37ee88

system/lib/pthread/pthread_self_stub.c
/*
 * Copyright 2021 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */

system/lib/pthread/library_pthread_stub.c
/*
 * Copyright 2019 The Emscripten Authors.  All rights reserved.
 * Emscripten is available under two separate licenses, the MIT license and the
 * University of Illinois/NCSA Open Source License.  Both these licenses can be
 * found in the LICENSE file.
 */


===== Observed WASI API CC0-1.0 full terms =====
Source evidence: /Users/josecosta/.agents/artifacts/sourdaw/WORKFLOW-REASSESS-2026-10-23/R4634-first-pinned-build-author-sol/notice-supplement/CC0-1.0.txt
SHA256: a2010f343487d3f7618affe54f789f5487602331c0a8d03f49e9a7c547cf0499

Creative Commons Legal Code

CC0 1.0 Universal

    CREATIVE COMMONS CORPORATION IS NOT A LAW FIRM AND DOES NOT PROVIDE
    LEGAL SERVICES. DISTRIBUTION OF THIS DOCUMENT DOES NOT CREATE AN
    ATTORNEY-CLIENT RELATIONSHIP. CREATIVE COMMONS PROVIDES THIS
    INFORMATION ON AN "AS-IS" BASIS. CREATIVE COMMONS MAKES NO WARRANTIES
    REGARDING THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS
    PROVIDED HEREUNDER, AND DISCLAIMS LIABILITY FOR DAMAGES RESULTING FROM
    THE USE OF THIS DOCUMENT OR THE INFORMATION OR WORKS PROVIDED
    HEREUNDER.

Statement of Purpose

The laws of most jurisdictions throughout the world automatically confer
exclusive Copyright and Related Rights (defined below) upon the creator
and subsequent owner(s) (each and all, an "owner") of an original work of
authorship and/or a database (each, a "Work").

Certain owners wish to permanently relinquish those rights to a Work for
the purpose of contributing to a commons of creative, cultural and
scientific works ("Commons") that the public can reliably and without fear
of later claims of infringement build upon, modify, incorporate in other
works, reuse and redistribute as freely as possible in any form whatsoever
and for any purposes, including without limitation commercial purposes.
These owners may contribute to the Commons to promote the ideal of a free
culture and the further production of creative, cultural and scientific
works, or to gain reputation or greater distribution for their Work in
part through the use and efforts of others.

For these and/or other purposes and motivations, and without any
expectation of additional consideration or compensation, the person
associating CC0 with a Work (the "Affirmer"), to the extent that he or she
is an owner of Copyright and Related Rights in the Work, voluntarily
elects to apply CC0 to the Work and publicly distribute the Work under its
terms, with knowledge of his or her Copyright and Related Rights in the
Work and the meaning and intended legal effect of CC0 on those rights.

1. Copyright and Related Rights. A Work made available under CC0 may be
protected by copyright and related or neighboring rights ("Copyright and
Related Rights"). Copyright and Related Rights include, but are not
limited to, the following:

  i. the right to reproduce, adapt, distribute, perform, display,
     communicate, and translate a Work;
 ii. moral rights retained by the original author(s) and/or performer(s);
iii. publicity and privacy rights pertaining to a person's image or
     likeness depicted in a Work;
 iv. rights protecting against unfair competition in regards to a Work,
     subject to the limitations in paragraph 4(a), below;
  v. rights protecting the extraction, dissemination, use and reuse of data
     in a Work;
 vi. database rights (such as those arising under Directive 96/9/EC of the
     European Parliament and of the Council of 11 March 1996 on the legal
     protection of databases, and under any national implementation
     thereof, including any amended or successor version of such
     directive); and
vii. other similar, equivalent or corresponding rights throughout the
     world based on applicable law or treaty, and any national
     implementations thereof.

2. Waiver. To the greatest extent permitted by, but not in contravention
of, applicable law, Affirmer hereby overtly, fully, permanently,
irrevocably and unconditionally waives, abandons, and surrenders all of
Affirmer's Copyright and Related Rights and associated claims and causes
of action, whether now known or unknown (including existing as well as
future claims and causes of action), in the Work (i) in all territories
worldwide, (ii) for the maximum duration provided by applicable law or
treaty (including future time extensions), (iii) in any current or future
medium and for any number of copies, and (iv) for any purpose whatsoever,
including without limitation commercial, advertising or promotional
purposes (the "Waiver"). Affirmer makes the Waiver for the benefit of each
member of the public at large and to the detriment of Affirmer's heirs and
successors, fully intending that such Waiver shall not be subject to
revocation, rescission, cancellation, termination, or any other legal or
equitable action to disrupt the quiet enjoyment of the Work by the public
as contemplated by Affirmer's express Statement of Purpose.

3. Public License Fallback. Should any part of the Waiver for any reason
be judged legally invalid or ineffective under applicable law, then the
Waiver shall be preserved to the maximum extent permitted taking into
account Affirmer's express Statement of Purpose. In addition, to the
extent the Waiver is so judged Affirmer hereby grants to each affected
person a royalty-free, non transferable, non sublicensable, non exclusive,
irrevocable and unconditional license to exercise Affirmer's Copyright and
Related Rights in the Work (i) in all territories worldwide, (ii) for the
maximum duration provided by applicable law or treaty (including future
time extensions), (iii) in any current or future medium and for any number
of copies, and (iv) for any purpose whatsoever, including without
limitation commercial, advertising or promotional purposes (the
"License"). The License shall be deemed effective as of the date CC0 was
applied by Affirmer to the Work. Should any part of the License for any
reason be judged legally invalid or ineffective under applicable law, such
partial invalidity or ineffectiveness shall not invalidate the remainder
of the License, and in such case Affirmer hereby affirms that he or she
will not (i) exercise any of his or her remaining Copyright and Related
Rights in the Work or (ii) assert any associated claims and causes of
action with respect to the Work, in either case contrary to Affirmer's
express Statement of Purpose.

4. Limitations and Disclaimers.

 a. No trademark or patent rights held by Affirmer are waived, abandoned,
    surrendered, licensed or otherwise affected by this document.
 b. Affirmer offers the Work as-is and makes no representations or
    warranties of any kind concerning the Work, express, implied,
    statutory or otherwise, including without limitation warranties of
    title, merchantability, fitness for a particular purpose, non
    infringement, or the absence of latent or other defects, accuracy, or
    the present or absence of errors, whether or not discoverable, all to
    the greatest extent permissible under applicable law.
 c. Affirmer disclaims responsibility for clearing rights of other persons
    that may apply to the Work or any use thereof, including without
    limitation any person's Copyright and Related Rights in the Work.
    Further, Affirmer disclaims responsibility for obtaining any necessary
    consents, permissions or other rights required for any use of the
    Work.
 d. Affirmer understands and acknowledges that Creative Commons is not a
    party to this document and has no duty or obligation with respect to
    this CC0 or use of the Work.


===== Observed WASI API origin statement =====
/**
 * THIS FILE IS AUTO-GENERATED from the following files:
 *   typenames.witx, wasi_snapshot_preview1.witx
 *
 * @file
 * This file describes the [WASI] interface, consisting of functions, types,
 * and defined values (macros).
 *
 * The interface described here is greatly inspired by [CloudABI]'s clean,
 * thoughtfully-designed, capability-oriented, POSIX-style API.
 *
 * [CloudABI]: https://github.com/NuxiNL/cloudlibc
 * [WASI]: https://github.com/WebAssembly/WASI/
 */

/*
 * File origin:
 *   https://github.com/WebAssembly/wasi-libc/blob/main/libc-bottom-half/headers/public/wasi/api.h
 * Revision:
 *   2c2fc9a2fddd0927a66f1c142e65c8dab6f5c5d7
 * License:
 *   CC0 1.0 Universal (CC0 1.0) Public Domain Dedication
 *   https://creativecommons.org/publicdomain/zero/1.0/
 */


===== Changed wrapper notice =====
Modified 2026-10-29: the Vorbis wrapper replaces its old embedded WASM and fixed loader with an imported paired Emscripten factory and current real heap views. Its public free now idempotently releases a configured native encoder, zeroing the reference before release and clearing the wrapper even on cleanup error. The Vorbis C glue is additionally modified by a retained source patch: a calloc-zeroed per-encoder flag uses existing libogg flush for the first audio packet only, preserving packet bytes and exact short-file page positioning. Other original wrapper bytes are preserved. Opus generated factory/WASM rebuilt from the retained exact source and official SDK archive.

Modified 2026-10-29: the pinned Xiph libvorbis lib/block.c missing-history branch now fills only the existing virtual leading context for 1–32 real input frames using a half-Hanning extension of the first sample. Original programme PCM, granule counts, EOF logic and muxing are unchanged. The original Xiph copyright, BSD license and disclaimers above remain retained. Exact preimage, owned source patch and resulting source hash are recorded in the canonical audio-export-codecs provenance/build records.
