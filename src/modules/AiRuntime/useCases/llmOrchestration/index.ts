export { type ToolCallResult, type AiBackend } from './types';
export { resolveBackend, isLlmAvailable } from './backendResolution';
export { initEngine, unloadEngine } from './lifecycle';
export { generateToolCalls } from './inference';
