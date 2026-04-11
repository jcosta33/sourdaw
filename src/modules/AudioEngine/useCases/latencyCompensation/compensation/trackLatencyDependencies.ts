import { getTrackStoreState } from '#/modules/Arrangement/useCases';

export const trackLatencyDependencies = {
    getTrackStoreState,
} as const;