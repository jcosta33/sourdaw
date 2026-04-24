import { trackStore } from '#/modules/Arrangement/stores';

import { audioEngine } from '../../../repositories/createWebAudioEngine';

import { getMaxTrackLatency, getTrackLatency } from './helpers';

export const latencyReportDependencies = {
    getTrackStoreState: () => trackStore.value,
    getTrackLatency,
    getMaxTrackLatency,
    audioEngine,
} as const;
