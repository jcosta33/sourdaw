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
