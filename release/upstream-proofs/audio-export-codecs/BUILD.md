# Pinned codec build recipe

Use the immutable source revisions and official macOS arm64 SDK archive hashes in provenance.json. Keep EM_CONFIG and EM_CACHE private, EMCC_CORES=2 and build parallelism2. Apply the repository resource guard sequentially from the owned lane. No global SDK activation/profile/cache changes are required.

The initial install used the exact emsdk installer source and `emsdk.py install 6.0.13`, then private activation. Before using it, hash the downloaded SDK archive against provenance.json, check actual reported revisions, and verify the retained runtime-source and observed-header hashes. The release DEPS do not establish the packaged backend source; retain that discrepancy. The original preparation SDK-installer archive-hash defect has a separate causal correction record and must not be copied.

With the pinned source trees under BUILD_ROOT/source and the repository under REPOSITORY_ROOT, execute the exact ordered argv records in reproduction-commands.json after substituting BUILD_ROOT. They first apply the addressed Vorbis primer-page patch to its verified upstream preimage, then configure and build libogg, Vorbis and Opus in a fresh clean-paired output, then generate both paired ES-module single-file factories. The original failed standalone/manual-metadce route is not the final recipe. The first paired runtime reused existing codec archives; the required independent clean proof rebuilt every archive with a fresh runtime cache, and both initial generated assets plus all four archives matched byte for byte without normalization. The later primer-page repair independently relinked only Vorbis with the same hashed archives and two fresh runtime caches; those repaired factories also match byte for byte.

Vorbis keeps its named enc/version/mime/malloc/free functions and uses the generated factory startup and current actual HEAPU8/HEAP32/HEAPF32. The owned wrapper transformation is specified and inverse-byte checked in probe_paired_vorbis_corrected.mjs: remove exactly the old payload and fixed loader, import the local generated factory, and insert the current-view adapter and prominent modification notice. The other five original runtime/declaration files remain byte-identical. Regenerate the entire Opus JS/WASM factory; retain its original core/muxer wrapper and public API. Never combine newly built WASM with stale generated SDK-specific glue.

Retain all notices from the exact mapped runtime/codec source envelope and observed pthread, compatibility, WASI and actual LLVM header supplements. Append the complete notice proposal to the existing public/legal/THIRD-PARTY-NOTICES.md, preserving existing text; do not invent a parallel legal file. The canonical audio-export-codecs surface must address every final runtime/declaration asset, these build/provenance records and the resulting complete existing notice file. The generic inventory snapshot/validator and existing source/web/desktop package-proof readers already consume those addressed records. Do not edit package/lock/dependency-report/proof, CI/build implementation, Rust/project-WASM or Grand Boule surfaces for this route.

This private packet is not a release or full feature acceptance. Actual feature integration must retain both codecs, independent decode/quality/duration, continuous direct-from-source48k Opus preparation, bounded Worker backpressure/cancellation/lifetime, browser/native output and honest original AC002 memory evidence.

## Exact wrapper transformation

Original wrapper SHA256: a8d1cd53edbcf3d53a879c1b9829e96653ef9ac40da2c95326a10ccebb513728. The old loader starts at `async function w(A) {` and ends immediately before `\nvar B =`; require loader SHA256 d8729c10b2ab64f02c2d793c1795c18e49a55867fbde1478927ee9fc1836d15e. Require one data:application/wasm;base64 URI whose decoded SHA256 is cd1f50349e58e650e33e3f0b850a785ed612c4abaa4756e520e50b2583cf07ed. Replace that loader with the following exact text, replace its single `I("audio/ogg", "<old-data-URI>")` call with `I("audio/ogg")`, and prepend the comment and import below. Invert exactly those operations and require complete original-byte equality.

```text
async function w() {
  const module = await createVorbisModule();
  return {
    enc_init: module._enc_init,
    enc_encode: module._enc_encode,
    enc_flush: module._enc_flush,
    enc_free: module._enc_free,
    enc_get_pcm: module._enc_get_pcm,
    enc_get_out_buf: module._enc_get_out_buf,
    version: module._version,
    mime_type: module._mime_type,
    malloc: module._malloc,
    free: module._free,
    getInt32Array(ptr, length) { return new Int32Array(module.HEAP32.buffer, ptr, length); },
    getFloat32Array(ptr, length) { return new Float32Array(module.HEAPF32.buffer, ptr, length); },
    getUint8Array(ptr, length) { return new Uint8Array(module.HEAPU8.buffer, ptr, length); },
    getString(ptr) { return module.UTF8ToString(ptr); }
  };
}
```

Prepend exactly these two lines, each followed by a newline:

```text
// Modified 2026-10-29: replace embedded WASM/loader with a paired Emscripten factory and current heap views.
import createVorbisModule from "./vorbis.wasm.js";
```

Preserve all other original bytes. The current exact prefix, adapter and public-free preimage/replacement strings, final SHA256 and inverse-byte requirement are data in reproduction-commands.json.wrapperTransformation. Those strings are authoritative, so Markdown formatting cannot change reproduced wrapper bytes.

## Ordinary native release completion

After the reversible loader transformation above, replace only the original public `function free() { enc = null; }` body with the body shipped in vendor/vorbis/ogg-encode.js: if enc.ref is configured, retain its value, zero it before calling enc.module.enc_free(ref), and clear enc in finally. Otherwise clear enc directly. Repeated free and free before the first inferred channel configuration make no native call. Update the prominent modification line to `// Modified 2026-10-29: paired Emscripten factory/current heap views; idempotent native encoder cleanup.`. This completion calls the same existing native API used by original configure(), without changing either generated factory. Native cleanup errors still reach the caller, whose finally terminates the Worker. The historical frozen wrapper proposal remains in the external first-build packet; the canonical current hash records this explicit later modification.

## Vorbis first-audio-page repair

Apply `vorbis-primer-page.patch` with `/usr/bin/patch -p1 -i REPOSITORY_ROOT/release/upstream-proofs/audio-export-codecs/vorbis-primer-page.patch` from BUILD_ROOT/source/wasm-media. Require the original src/wasm/vorbis/vorbis_enc.c SHA256 881f20eb195d20c879a9bd88abd6568399b888d6e89207ef155616dc828fe788 before applying and repaired SHA256 747b62128339b4e4fc365563f2740b735e9e9d63f4166ac98db0ea845601c9c6 afterwards. The patch adds one calloc-zeroed per-encoder flag and uses existing libogg flush for the first audio packet only. It preserves codec packets, standard header/CRC/granule/EOS handling, remaining page flow and native cleanup. No codec library, SDK or compilation setting changes.

This establishes the primer packet's zero granule on its own page so a very short final page can specify the exact end without an ambiguous start. The original short files decoded with missing samples or failed Chromium decode; packet-identical private repagination isolated the cause before this source repair. The actual repaired link keeps the same observed archive-member input list and all 43 glue dependency contents except the owned C change. Retained notices cover the unchanged codec/runtime/header envelope and the MIT upstream glue; the existing public notice explicitly identifies this modification. Page correctness does not prove representative programme-level quality. Apply the unchanged0.5dB bound to the maintained programme/parity fixtures; preserve one-sample/DC/transient diagnostic levels and validity/nonregression obligations separately.

## Modified libvorbis virtual-prefix source

Apply the addressed `vorbis-short-leading-context.patch` to the exact pinned `lib/block.c` preimage SHA256 `7f65c7031c2b94405d2c1b5f0a73cc19efe9506e95736ba0b38d86bd42170a7e`; require postimage `e5643f5f9947fcfb7d08824338b02af28b2d2dd30acb311c85d0efb2c7160453` and patch SHA256 `49ddc53f865c69d4ec9e6cb4d4594afe22ffc805a5920d828d8009cc68c09789`. This explicitly modifies libvorbis. Only the existing virtual prefix for missing LPC history (1–32 real frames) changes; original programme samples, granules, EOF, muxer and other source files remain unchanged.

The structured modifiedLibvorbisPreparation/ActualCommands records provide the exact first executed source layout and argv. Reuse the already-hashed original libogg/libvorbisenc/Opus inputs; rebuild only the modified libvorbis library and paired Vorbis factory. The existing primer-glue source patch remains applied. Keep the same pinned SDK, compilation/link settings and private configuration/cache; no new import, flag, handwritten WASI or production muxer is introduced. The original frozen factory/archives and failures remain in retained evidence.

First actual input closure: exactly one libvorbis source file differs; every other block dependency has the same content and the observed archive-member input set matches the prior source/notice-qualified envelope. The existing authoritative legal file retains Xiph BSD terms and all compiler/runtime/header notices, with a prominent owned libvorbis modification notice added. An independent fresh-output/cache repeat rebuilt only the modified libvorbis archive and paired Vorbis factory; both match raw bytes. The actual glue/block header contents and archive-member families also match. ABI, owning real encoder/Worker and complete-file Chromium normal/short/lifecycle checks passed for these bytes. These observations are not full AC001, continuous AC002 or actual native/platform acceptance.

## Source-only integration boundary

The structured independent-repeat records retain exact argv, private SDK/config/cache settings, source-copy/patch preconditions and output identities. Keep the historical C13 factories/source records and failures intact. No Opus context, codec gain, bitrate or tolerance change is part of the Vorbis source repair. The fixed codec heaps remain included in the unresolved original memory obligation.

Before distribution, finish the prominent modified-libvorbis notice in the existing authoritative THIRD-PARTY-NOTICES file and update EVERY path-addressed consumer of its combined final bytes, including the four pre-existing DDSP/WebLLM/adapted-source records as well as audio-export-codecs. Preserving those four old hashes after appending notices is incorrect. This shared notice/digest phase is currently held under the actual foreign5865 collision; this source checkpoint is not publication-ready. Do not create an alternate ignored notice file or omit those consumer records.
