# Maintained audio dependency ports

The workspace resolves exact producing-parent edges before pnpm applies each patch. Patched metadata documents the changed contract but cannot change pnpm's already-resolved child. `verifyInstalled.mjs` compares every installed package file with `provenance.json`, including unchanged licenses and ORT WASM files, and follows physical child links. Original package version identities remain unchanged. The provenance records bind official npm tarballs by SHA512 SRI and the modified bytes by SHA256.

The umbrella patch uses pnpm 12's deleted-file header operation to keep original one-line maps out of the tracked patch. Direct Git application of this compact form fails with `removal patch leaves file contents`. `expandTensorFlowPatch.mjs <repository> <official-tfjs-4.22.0.tgz> <new-full-patch>` authenticates the original archive by SHA256 and SHA512 SRI, validates every deleted map hash, and reconstructs the byte-exact original standard Git patch for independent check/apply. This changes patch representation only; installed outputs and deletions remain fixed by the complete inventory.

TensorFlow's core and umbrella contain embedded Long and fetch implementations in several formats. Their unminified source patches and eight generated minified/miniprogram routes travel together. `regenerateTensorFlow.mjs <repository> <private-patched-package> <core|umbrella>` regenerates those outputs with esbuild 0.28.2, ES2017, inline legal notices and genuine minification. Run it only on a private package copy. The published miniprogram output remains identical to its generic minified counterpart. The maintained spec checks independent FarmHash literals, frozen Long4 vectors, overflow/unsigned behavior, fetch receiver/init/response/rejection, deep ESM injection, all eight formats and actual custom-module CLI output.

TypeScript 7 supplies common DOM and WebWorker WebGPU declarations. The authentic `@webgpu/types@0.1.74` patch adds the actual application requirements missing from those libraries: featureLevel, usage globals and canvas overloads. It deliberately omits conflicting common declarations, upstream constructor restrictions, and the five experimental feature-name literals the native compiler does not expose. This is an application typing contract, not full upstream API parity. Root type imports and triple-reference paths remain required.

The ONNX patch recompiles the nine protobuf-consuming all/WebGL bundles against protobufjs 8.8.1. It leaves generated ONNX schema/declarations, other public exports and WASM bytes unchanged. Valid independent wire bytes, signedness, oneof/default/UTF8 behavior must remain equal to the frozen publisher capture. Current protobuf deliberately rejects malformed lengths and varints; preserving the publisher's invalid-input acceptance would weaken that contract.

To reproduce ONNX outputs, start from the installed repository and an absent private capsule destination:

```sh
node scripts/dependencyPorts/onnx/prepare.mjs "$REPOSITORY" "$REPRODUCTION"
CAPSULE="$REPRODUCTION/onnx-protobuf-runtime/capsule"
pnpm --dir "$CAPSULE/js" install --ignore-workspace --ignore-scripts
node scripts/dependencyPorts/onnx/compile-driver.mjs "$CAPSULE"
node "$CAPSULE/js/web/script/build.js" --bundle-mode=prod --bundle-scope=protobuf-port --no-webgpu-ep --no-jspi
python3 scripts/dependencyPorts/onnx/qualify.py "$CAPSULE"
```

Wrap each compute command with the repository resource guard. The new reproduction directory retains the qualified relative source-map layout using private, authenticated copies of installed dependencies. It accepts no private source paths. The exact standalone producer dependencies live in `onnx/package.json`. `build.ts.txt` is source input materialized as build.ts inside the private capsule, derived from the official ORT v1.31.1 producer at commit `6af1a932e2286d5c58166085d24c68783033edee`; `upstream-producer.patch` records that bounded adaptation. Protobuf must be copied adjacent to Long, because a symlink can resolve a different Long owner. The qualifier requires real Reader input, authentic embedded map sources, genuine minification, unchanged schema/public bytes, and byte equality with every accepted generated output. It does not create an inference session or fetch a model.

Meyda retains its published DSP and FFT algorithm bytes, including FFTjs's historical complex-IFFT conjugation behavior. Its published ESM imports tslib, so tslib is a real runtime edge. WAV and duplex streams retain PCM values, backpressure and completion; readable-stream 4 legitimately emits end and finish in a different relative order. QR rendering preserves original matrix/pixels and propagates encoder errors with one settlement. The focused fixture runs the actual Meyda and QR CLIs, independent WAV/ZIP inputs and slow/erroring streams. No old Babel build graph is installed to execute this proof.

Run the maintained focused contracts with:

```sh
pnpm guard --profile focused --max-rss-mib 2048 --show-output -- pnpm test:run scripts/__tests__/audioDependencyPorts.spec.ts
```

These contracts do not establish GPU hardware inference, Windows execution, full project/history acceptance, or an entire latest dependency graph. Bundled Basic Pitch full-output CPU preservation and product acceptance remain separate checks.
