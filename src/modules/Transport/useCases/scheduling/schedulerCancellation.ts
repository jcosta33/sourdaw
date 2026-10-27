import type { LiveYeastIteration } from './processLiveYeastTrackBlock';

export type SchedulerCancellation = {
    generation: number;
    /** Semantic timeline identity; unlike generation, loop wraps and jumps advance it without cancellation. */
    discontinuityEpoch: number;
    isCurrent: () => boolean;
    yeastRouteLineage: Map<string, LiveYeastIteration>;
};
