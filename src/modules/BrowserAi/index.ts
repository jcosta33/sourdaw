/**
 * BrowserAi module — browser-native AI audio generation.
 *
 * Provides DDSP instrument synthesis, Kokoro TTS, and DiffSinger SVS
 * running entirely in the browser via WebGPU on Chrome.
 *
 * Public surface:
 * - Use cases: detectCapabilities, downloadModel, removeModel, cancelRender,
 *              renderAllStale, renderDdspInstrument, renderKokoroTts, renderDiffSingerPhrase
 * - Stores: capabilityStore, modelRegistryStore, renderQueueStore, inferenceProgressStore
 * - Views: ModelManagerPanel, CapabilityReportPanel, RenderProgressIndicator
 * - Events (types only): RenderCompletePayload, RenderProgressPayload,
 *                        ModelDownloadProgressPayload, CapabilityDetectedPayload
 */

// Use cases
export { initBrowserAi, DDSP_INSTRUMENT_CATALOG } from './useCases/initBrowserAi';
export type { RenderQuality } from './useCases/initBrowserAi';
export { detectCapabilities } from './useCases/detectCapabilities';
export { downloadModel } from './useCases/downloadModel';
export { removeModel } from './useCases/removeModel';
export { cancelRender } from './useCases/cancelRender';
export { renderAllStale } from './useCases/renderAllStale';
export { renderDdspInstrument } from './useCases/renderDdspInstrument';
export { renderKokoroTts } from './useCases/renderKokoroTts';
export { renderDiffSingerPhrase } from './useCases/renderDiffSingerPhrase';

// Stores (runtime values — React components use useStore(store))
export { capabilityStore } from './stores/capabilityStore';
export { modelRegistryStore } from './stores/modelRegistryStore';
export { renderQueueStore } from './stores/renderQueueStore';
export { inferenceProgressStore } from './stores/inferenceProgressStore';

// Views
export { ModelManagerPanel, CapabilityReportPanel, RenderProgressIndicator, KokoroVoiceSelector } from './presentations/views';


// Events (types only — follow event contract pattern)
export type { RenderCompletePayload, RenderProgressPayload, ModelDownloadProgressPayload, CapabilityDetectedPayload } from './events';
