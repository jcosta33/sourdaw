/**
 * The AudioWorklet processor sources in `public/audio/worklets/` are plain JS
 * shipped as static assets: they export nothing and are loaded by URL through
 * `AudioWorklet.addModule()`, so no build step ever types them.
 *
 * A spec that drives one imports it for its side effect — the `registerProcessor`
 * call — with the worklet globals stubbed. This declares that side-effect import,
 * and nothing more: there is no shape to describe, because there is no export.
 */
declare module '*/public/audio/worklets/native-plugin-bridge-processor.js';
