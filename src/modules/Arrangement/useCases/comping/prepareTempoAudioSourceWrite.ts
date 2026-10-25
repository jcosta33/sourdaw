import { type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';
import { isTempoAudioSourcePromotion } from '#/utils/tempoAudioSourcePromotion';
import { valuesEqual } from '#/utils/structuralEquality';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { projectTempoAudioSources } from '../../stores/tempoAudioSources';
import { captureTempoAudioSourceWriteIntent } from '../../stores/tempoAudioSourceWriteIntent';

import { captureTempoAudioSources } from './captureTempoAudioSources';
import { getTrackStoreState } from '../getTrackStoreState';

type Input = {
    readonly promotion: TempoAudioSourcePromotionSnapshot;
    readonly direction: 'promote' | 'restore';
    /** The original, pre-edit map. Neither callback is persisted. */
    readonly timeline: TempoTimeline;
    readonly clock: { readonly transport: unknown; readonly tempoMap: unknown };
    readonly target: { readonly tempoChangeId: string | null; readonly expectedBpm: number; readonly bpm: number };
};

function sameMembers<Value>(actual: readonly Value[], expected: readonly Value[]): boolean {
    return (
        actual.length === expected.length && expected.every((value) => actual.some((row) => valuesEqual(row, value)))
    );
}

/** A tempo edit governs every live legacy source, including one introduced
 * after admission. Its uncaptured conversion must refuse rather than silently
 * reinterpret it. Complete canonical and cosmetic peers need no conversion.
 * These are source deltas, never a whole-track or whole-lane snapshot CAS. */
function sameRequiredCapture(
    actual: TempoAudioSourcePromotionSnapshot,
    expected: TempoAudioSourcePromotionSnapshot
): boolean {
    return (
        sameMembers(actual.clips, expected.clips) &&
        sameMembers(actual.takes, expected.takes) &&
        sameMembers(actual.regions, expected.regions) &&
        sameMembers(actual.gaps, expected.gaps)
    );
}

export function prepareTempoAudioSourceWrite(input: Input) {
    const promotion = input.promotion;
    const tracks = getTrackStoreState();
    const lanes = takeLaneStore.value;
    if (!isTempoAudioSourcePromotion(promotion)) {
        return null;
    }
    const projected = projectTempoAudioSources(tracks?.tracks ?? [], lanes?.lanes ?? [], promotion, input.direction);
    if (!projected) {
        return null;
    }
    const before =
        input.direction === 'promote' ? { tracks: tracks?.tracks ?? [], lanes: lanes?.lanes ?? [] } : projected;
    const captured = captureTempoAudioSources(before.tracks, before.lanes, input.timeline);
    if (!captured || !sameRequiredCapture(captured, promotion)) {
        return null;
    }
    const intent = captureTempoAudioSourceWriteIntent({
        promotion,
        direction: input.direction,
        target: input.target,
        context: { ...input.clock, tracks, takeLanes: lanes },
    });
    return intent ? { tracks, lanes, projected, intent } : null;
}
