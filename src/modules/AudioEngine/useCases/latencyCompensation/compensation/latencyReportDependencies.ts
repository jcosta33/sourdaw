import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { audioEngine } from '../../../repositories/createWebAudioEngine';

import { getMaxTrackLatency, getTrackLatency } from './helpers';

export const latencyReportDependencies = {
    getTrackStoreState,
    getTrackLatency,
    getMaxTrackLatency,
    audioEngine,
} as const;
