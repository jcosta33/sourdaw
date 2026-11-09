# Standing probes: bundled model assets

A model topology file is not a complete model. Manifest-relative weight paths must resolve to the assets emitted
by the production bundler, and inference must execute those actual bytes. Development dependency paths and mocked
note results cannot establish packaged availability.

## Standing probes

1. **A bundled topology retains an unbundled weight filename (`5a1067d3a6`, merged by `8f96c82bae`).** The Basic Pitch
   URL import emitted only model.json; its manifest still requested group1-shard1of1.bin beside the fingerprinted
   topology. The introducing merge has no PR number in its local history. The missed stance was packaged inference
   availability: constructor/count tests replaced BasicPitch and never fetched weights or executed inference.
   Build the actual owning repository entry with the production URL pipeline and require byte-exact topology and
   weights plus generated references to both. Run real TensorFlow/BasicPitch inference against actual npm model
   bytes with differently fingerprinted topology and weight URLs, rejecting the manifest-relative sibling. Assert
   independently specified pitches and broad physical note times, unchanged source PCM, and successful fresh loading
   after a transport failure. Removing the weight URL import/converter must fail
   `src/modules/AudioAnalysis/repositories/__tests__/loadBasicPitchModel.assets.spec.ts` or
   `src/modules/AudioAnalysis/useCases/__tests__/polyphonicAudioToMidi.realModel.integration.spec.ts`.
   Use the model library's same TensorFlow runtime; a graph from another installed major is not an interchangeable
   constructor argument. Probe only on a clean committed exclusive reviewer handoff; report an unrun probe as unrun.

2. **Sequential model windows overwrite earlier output (`b7e72968f4`; caught during #6349 review).** The original
   polyphonic transcription callback replaced frames, onsets and contours on every BasicPitch callback. The
   packaged-inference test initially used one second of audio, so it could not observe the library's multiple
   sequential output windows. A real four-second C4/E4 source then yielded only the final window, with notes ending
   near 0.67 seconds. Keep a deterministic unequal-chunk test that asserts every ordered row exactly once in all
   three streams, plus real inference longer than one window. Independently assert both known pitches near the
   beginning and end of the physical source and their interval-union coverage; neural retriggers may split held
   notes, so neither note count nor one longest-note duration establishes complete transcription. Replacing any
   append loop with last-chunk assignment must fail the exact stream test in `polyphonicAudioToMidi.spec.ts`;
   restoring all three assignments must fail the absolute-time/coverage oracle in
   `polyphonicAudioToMidi.realModel.integration.spec.ts`. The introducing commit has no PR number established here.

3. **Cold optimization invalidates a running neural worker's child-script URL.** With ORT 1.31.1 and Vite 8.3.6
   (current pins from `e14fdb7a37`, #6285), lazy discovery changed the optimized module hash after its first response.
   ORT pthreads reused that old `import.meta.url`; Vite's fresh-request hash guard rejected their requests while
   session creation remained pending. The initial ONNX worker dates to `a2fca1fc7d`; its associated-PR lookup returned
   none. Neither that commit nor #6285 is proven to be the first revision exposing this failure. The missed probe
   was actual cold neural session and inference composition: mocked worker outputs and a warm graph cannot expose
   invalidated child URLs. Keep the real verified model, voice, tokenizer, OPFS, workers, ORT, resampler and cache in
   `tests/e2e/kokoroNeuralPipeline.spec.ts`. Require the actual session-created provider receipt and independently
   bounded finite, nonconstant PCM; `navigator.gpu` does not establish GPU execution, and a WASM receipt claims CPU
   execution only. On a clean exclusive reviewer handoff, remove the ORT startup preinclude and run that exact case
   after the config change invalidates Vite's dependency hash; cold nested-worker loading must fail. Do not delete
   caches, reload or retry into a warm pass, lower thread count, swap models/providers, or raise the case bound.
   The observed failure exposed blocked child requests; a raw 504 response was inferred from Vite's exact loader
   guard and error path, not captured directly. Real numerical output still makes no intelligibility or perceptual
   quality claim.

## Scope

This class covers the shipped inference boundary between model topology, emitted weight assets, the runtime that
consumes them, and complete model output. Release-provenance probes authenticate records and digests; test-validity
probes establish observation. Neither alone proves that a packaged model resolves its weights and preserves all
windows of its supported runtime's output. Keep probes tied to observed independent failures rather than inventing
variants to reach a numeric minimum.
