import { trackStore } from '#/modules/Arrangement/stores';

export const trackLatencyDependencies = {
    getTrackStoreState: () => trackStore.value,
} as const;
