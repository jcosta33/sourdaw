# Standing probes: bundled model assets

A model topology file is not a complete model. Manifest-relative weight paths must resolve to the assets emitted
by the production bundler, and inference must execute those actual bytes. Development dependency paths and mocked
note results cannot establish packaged availability.

## Standing probes

1. **A bundled topology must not retain an unbundled weight filename.** The Basic Pitch URL import emitted only
   `model.json` while its manifest still requested `group1-shard1of1.bin` beside the fingerprinted topology;
   constructor/count tests replaced BasicPitch and never fetched weights or executed inference. Build the actual
   owning repository entry with the production URL pipeline and require byte-exact topology and weights plus
   generated references to both. Run real TensorFlow/BasicPitch inference against actual npm model bytes with
   differently fingerprinted topology and weight URLs, rejecting the manifest-relative sibling. Assert
   independently specified pitches and broad physical note times, unchanged source PCM, and successful fresh
   loading after a transport failure. Removing the weight URL import/converter must fail
   `src/modules/AudioAnalysis/repositories/__tests__/loadBasicPitchModel.assets.spec.ts` or
   `src/modules/AudioAnalysis/useCases/__tests__/polyphonicAudioToMidi.realModel.integration.spec.ts`. Use the
   model library's own TensorFlow runtime; a graph from another installed major is not an interchangeable
   constructor argument.
2. **Sequential model windows must not overwrite earlier output (#6349).** A transcription callback that replaces
   frames, onsets and contours on every BasicPitch callback keeps only the final window, and a one-second input
   cannot observe the library's multiple sequential output windows: a four-second C4/E4 source yielded notes ending
   near 0.67 seconds. Keep a deterministic unequal-chunk test that asserts every ordered row exactly once in all
   three streams, plus real inference longer than one window. Independently assert both known pitches near the
   beginning and end of the physical source and their interval-union coverage; neural retriggers may split held
   notes, so neither note count nor one longest-note duration establishes complete transcription. Replacing any
   append loop with last-chunk assignment must fail the exact stream test in
   `src/modules/AudioAnalysis/useCases/__tests__/polyphonicAudioToMidi.spec.ts`; restoring all three assignments
   must fail the absolute-time/coverage oracle in `polyphonicAudioToMidi.realModel.integration.spec.ts`.
3. **Cold dependency optimization must not invalidate a running neural worker's child-script URL (#6285).** Runs:
   author. Lazy dependency discovery can change the optimized module hash after its first response; ORT pthreads
   reuse the old `import.meta.url`, and Vite's fresh-request hash guard rejects their requests while session
   creation stays pending. Mocked worker outputs and a warm graph cannot expose invalidated child URLs. Keep the
   real verified model, voice, tokenizer, OPFS, workers, ORT, resampler and cache in
   `tests/e2e/kokoroNeuralPipeline.spec.ts`. Require the actual session-created provider receipt and independently
   bounded finite, nonconstant PCM; `navigator.gpu` does not establish GPU execution, and a WASM receipt claims CPU
   execution only. The author removes the ORT startup preinclude and runs that exact case after a config change
   invalidates Vite's dependency hash; cold nested-worker loading must fail. Do not delete caches, reload or retry
   into a warm pass, lower thread count, swap models/providers, or raise the case bound. The reviewer reads the
   Affected end-to-end job on the head for that spec and checks at the fixed commit that `onnxruntime-web` remains in
   the `optimizeDeps.include` list of `vite.config.ts`. Blocked child requests were observed; a raw 504 response is inferred
   from Vite's loader guard, not captured. Real numerical output makes no intelligibility or perceptual quality
   claim.

## Scope

This class covers the shipped inference boundary between model topology, emitted weight assets, the runtime that
consumes them, and complete model output. Release-provenance probes authenticate records and digests; test-validity
probes establish observation. Neither alone proves that a packaged model resolves its weights and preserves all
windows of its supported runtime's output. Keep probes tied to observed independent failures rather than inventing
variants to reach a numeric minimum.
