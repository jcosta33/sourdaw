import { getTrackStoreState } from '#/modules/Arrangement/useCases';

import { getTrackLatency } from './helpers';

export const maxTrackLatencyDependencies = {
    getTrackStoreState,
    getTrackLatency,
} as const;
