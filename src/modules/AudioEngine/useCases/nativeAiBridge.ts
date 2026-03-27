/**
 * Public contract re-exports for native AI bridge operations.
 *
 * Cross-module consumers should import these operations from this file
 * instead of directly from private repositories/nativeAIBridge.
 */
export { isTauri } from '../repositories/nativeAIBridge';
export { generateMidiAI, type GeneratedNote, type MidiGenerationResult } from '../repositories/nativeAIBridge';
export { denoiseAudio, type DenoiseResult } from '../repositories/nativeAIBridge';
