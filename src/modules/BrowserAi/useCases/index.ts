// BrowserAi/useCases — public contract surface for cross-module AI generation access.
// Re-exports only from files within this folder. See docs/architecture/03-typescript-module.md §3.3.

export { initBrowserAi, KOKORO_MODEL_ENTRY } from './initBrowserAi';
export { downloadModel } from './downloadModel';
export { removeModel } from './removeModel';
export { renderKokoroTts } from './renderKokoroTts';
export { renderDiffSingerPhrase } from './renderDiffSingerPhrase';
export { cancelRender } from './cancelRender';
export { detectCapabilities } from './detectCapabilities';
export { getRaveHandlers } from './getRaveHandlers';
export { initRaveModels } from './initRaveModels';
export { isRaveModelPresent } from './rave/isRaveModelPresent';
