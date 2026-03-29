/**
 * Public contract re-exports for AudioEngine model types.
 *
 * Cross-module consumers should import AudioEngine types from this file
 * instead of directly from private models/.
 */
export type { BusStrip } from '#/modules/AudioEngine/models/AudioEngineState';
export type { SidechainRoute } from '#/modules/AudioEngine/models/SidechainRoute';
export { createSidechainRoute } from '#/modules/AudioEngine/models/SidechainRoute';
export {
    type SynthParams,
    defaultSynthParams,
    type MpeParams,
    type DrumKit,
    type DrumKitVoice,
} from '#/modules/AudioEngine/models/SynthModels';
export { getDrumKitById, getDrumKitByIndex } from '#/modules/AudioEngine/models/factoryDrumKits';
export type { GeneratedNote } from '../models/GeneratedNote';
