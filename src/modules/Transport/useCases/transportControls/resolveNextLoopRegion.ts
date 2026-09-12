import { getLastClipEndBeat } from '#/modules/Arrangement/useCases';

import { getTimeSignatureSegmentAtBeat } from '../../models/TimeSignatureMap';
import { type TransportState } from '../../models/TransportState';
import { timeSignatureMapStore } from '../../stores/timeSignatureMapStore';

export type LoopRegion = Pick<TransportState, 'loopStart' | 'loopEnd' | 'isLooping'>;

function hasValidEnabledLoop(region: LoopRegion): boolean {
    return (
        Number.isFinite(region.loopStart) &&
        Number.isFinite(region.loopEnd) &&
        region.loopStart >= 0 &&
        region.loopEnd > region.loopStart
    );
}

export function resolveNextLoopRegion(state: TransportState | null): LoopRegion | null {
    if (!state) {
        return null;
    }

    if (state.isLooping) {
        return { loopStart: state.loopStart, loopEnd: state.loopEnd, isLooping: false };
    }

    const current = { loopStart: state.loopStart, loopEnd: state.loopEnd, isLooping: true };
    if (hasValidEnabledLoop(current)) {
        return current;
    }

    const lastClipEndBeat = getLastClipEndBeat();
    if (Number.isFinite(lastClipEndBeat) && lastClipEndBeat > 0) {
        return { loopStart: 0, loopEnd: lastClipEndBeat, isLooping: true };
    }

    const segment = getTimeSignatureSegmentAtBeat(
        timeSignatureMapStore.value?.changes ?? [],
        0,
        state.timeSignatureNumerator,
        state.timeSignatureDenominator
    );
    const endBeat = Math.min(segment.numerator * segment.beatUnit, segment.endBeat);
    if (!Number.isFinite(endBeat) || endBeat <= 0) {
        return null;
    }

    return { loopStart: 0, loopEnd: endBeat, isLooping: true };
}
