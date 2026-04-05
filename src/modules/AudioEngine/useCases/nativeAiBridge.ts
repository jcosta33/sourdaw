/**
 * Public contract re-exports for native AI bridge operations.
 *
 * Cross-module consumers should import these operations from this file
 * instead of directly from private repositories/nativeAIBridge.
 */
export { isTauri } from '../repositories/nativeAIBridge/isTauri';
export { generateMidiAI, type MidiGenerationResult } from '../repositories/nativeAIBridge/midiGeneration';
export { type GeneratedNote } from '../models/GeneratedNote';
export { denoiseAudio, type DenoiseResult } from '../repositories/nativeAIBridge/audioDenoising';
