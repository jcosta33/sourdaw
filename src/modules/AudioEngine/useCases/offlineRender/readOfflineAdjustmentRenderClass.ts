import { adjustmentLayerStore } from '#/modules/Arrangement/stores';

import {
    type OfflinePpqEndpointProjector,
    offlinePpqEndpointProjectorState,
} from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';

import { conservativeSpanEndBeat } from './conservativeSpanEndBeat';
import { readAdjustmentLayerConstancyThresholds } from './readAdjustmentLayerConstancyThresholds';

/** The renderer a target goes through: the whole-project mixdown, or one target's isolated subgraph. */
export type OfflineAdjustmentRenderRoute = 'mixdown' | 'subgraph';

/** The tempo and tempo map of the document a render reads, which the mixdown walks its span through. */
export type OfflineAdjustmentRenderTimeline = {
    tempo: number;
    changes: Parameters<OfflinePpqEndpointProjector>[0]['changes'];
};

/** The beat the mixdown classifies its compositions up to, for a render of `[0, endBeat]` of that document. */
function mixdownClassifiedEndBeat(endBeat: number, timeline: OfflineAdjustmentRenderTimeline): number {
    const project = offlinePpqEndpointProjectorState.project;
    if (!project) {
        throw new Error('Offline musical projection is not configured');
    }
    const { tempo: defaultTempo, changes } = timeline;
    // The projection counts whole frames; the agent measurement mixdown renders at 48 kHz.
    const { durationSeconds } = project({ startPpq: 0, endPpq: endBeat, defaultTempo, sampleRate: 48_000, changes });
    return conservativeSpanEndBeat(Math.max(0, durationSeconds), defaultTempo, changes);
}

/**
 * Which adjustment-layer decisions an offline render ending at `endBeat` takes, as a count: the live
 * layer stack's constancy thresholds that lie below the end the route classifies up to. The
 * subgraph classifies over `[0, endBeat]`; the mixdown over its conservative span, which is wider
 * and walked through the tempo map of the document it renders — a preview document's own, not the
 * live project's — so the caller names that document's `timeline`. Every layer's decision (fold or
 * schedule its level, apply or skip its DSP) only ever flips once as the end grows, so two renders
 * of one document ending where this reads the same take the same decisions for every window they
 * share — and two ending where it differs may not, so they cannot share one render. Every render
 * reads the live stack, whatever document it renders.
 */
export function readOfflineAdjustmentRenderClass(input: {
    endBeat: number;
    route: OfflineAdjustmentRenderRoute;
    timeline: OfflineAdjustmentRenderTimeline;
}): number {
    const thresholds = readAdjustmentLayerConstancyThresholds(adjustmentLayerStore.value?.layers ?? []);
    if (thresholds.length === 0) {
        return 0;
    }
    const classifiedEndBeat =
        input.route === 'mixdown' ? mixdownClassifiedEndBeat(input.endBeat, input.timeline) : input.endBeat;
    return thresholds.filter((threshold) => threshold < classifiedEndBeat).length;
}
