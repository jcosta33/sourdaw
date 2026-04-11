import { getMaxTrackLatency, getTrackLatency } from './helpers';

export const compensationDelayDependencies = {
    getMaxTrackLatency,
    getTrackLatency,
} as const;