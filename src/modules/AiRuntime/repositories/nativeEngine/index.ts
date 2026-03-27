export {
    initNativeEngine,
    stopNativeEngine,
    isNativeEngineReady,
    // Backward-compatible aliases
    initLlamaServer,
    stopLlamaServer,
    isLlamaServerRunning,
} from './lifecycle';
export { generateNativeCompletion } from './completions';
export { streamNativeCompletion } from './streaming';
