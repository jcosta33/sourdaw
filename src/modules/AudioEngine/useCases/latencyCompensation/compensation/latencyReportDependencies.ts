import { getTrackStoreState } from '#/modules/Arrangement/useCases';
import { audioEngine } from '#/modules/AudioEngine/repositories/createWebAudioEngine';
import { getMaxTrackLatency, getTrackLatency } from './helpers';

export const latencyReportDependencies = {
    getTrackStoreState,
    getTrackLatency,
    getMaxTrackLatency,
    audioEngine,
} as const;