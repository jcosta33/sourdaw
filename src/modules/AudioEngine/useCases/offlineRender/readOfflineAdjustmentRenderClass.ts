import { adjustmentLayerStore } from '#/modules/Arrangement/stores';
import { DEFAULT_TEMPO_BPM, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';

import { conservativeSpanEndBeat, readAdjustmentLayerConstancyThresholds } from './offlineAdjustmentLayers';

/** The renderer a target goes through: the whole-project mixdown, or one target's isolated subgraph. */
export type OfflineAdjustmentRenderRoute = 'mixdown' | 'subgraph';

/** The beat the mixdown classifies its compositions up to, for a render of `[0, endBeat]`. */
function mixdownClassifiedEndBeat(endBeat: number): number {
    const project = offlinePpqEndpointProjectorState.project;
    if (!project) {
        throw new Error('Offline musical projection is not configured');
    }
    const defaultTempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
    const changes = tempoMapStore.value?.changes ?? [];
    // The projection counts whole frames; the agent measurement mixdown renders at 48 kHz.
    const { durationSeconds } = project({ startPpq: 0, endPpq: endBeat, defaultTempo, sampleRate: 48_000, changes });
    return conservativeSpanEndBeat(Math.max(0, durationSeconds), defaultTempo, changes);
}

/**
 * Which adjustment-layer decisions an offline render ending at `endBeat` takes, as a count: the live
 * layer stack's constancy thresholds that lie below the end the route classifies up to. The
 * subgraph classifies over `[0, endBeat]`; the mixdown over its conservative span, which is wider.
 * Every layer's decision (fold or schedule its level, apply or skip its DSP) only ever flips once as
 * the end grows, so two renders ending where this reads the same take the same decisions for every
 * window they share — and two ending where it differs may not, so they cannot share one render.
 * Every render reads the live stack, whatever document it renders.
 */
export function readOfflineAdjustmentRenderClass(input: {
    endBeat: number;
    route: OfflineAdjustmentRenderRoute;
}): number {
    const thresholds = readAdjustmentLayerConstancyThresholds(adjustmentLayerStore.value?.layers ?? []);
    if (thresholds.length === 0) {
        return 0;
    }
    const classifiedEndBeat = input.route === 'mixdown' ? mixdownClassifiedEndBeat(input.endBeat) : input.endBeat;
    return thresholds.filter((threshold) => threshold < classifiedEndBeat).length;
}
