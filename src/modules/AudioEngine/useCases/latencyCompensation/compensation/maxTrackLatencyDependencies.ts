import { trackStore } from '#/modules/Arrangement/stores';

import { getTrackLatency } from './helpers';

export const maxTrackLatencyDependencies = {
    getTrackStoreState: () => trackStore.value,
    getTrackLatency,
} as const;
