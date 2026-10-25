import { type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';
import { isTempoAudioSourcePromotion, tempoSourcePromotionsEqual } from '#/utils/tempoAudioSourcePromotion';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Track } from '../../models/Track';
import { type TakeLane } from '../../models/TakeLane';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { projectTempoAudioSources } from '../../stores/tempoAudioSources';
import {
    captureTempoAudioSourceWriteIntent,
    type TempoAudioSourceWriteClock,
} from '../../stores/tempoAudioSourceWriteIntent';

import { captureTempoAudioSources } from './captureTempoAudioSources';
import { getTrackStoreState } from '../getTrackStoreState';

type Input = {
    readonly promotion: TempoAudioSourcePromotionSnapshot;
    readonly direction: 'promote' | 'restore';
    /** The original, pre-edit map. Neither callback is persisted. */
    readonly timeline: TempoTimeline;
    readonly clock: { readonly transport: unknown; readonly tempoMap: unknown };
    readonly owners?: { readonly tracks: readonly Track[]; readonly lanes: readonly TakeLane[] };
} & TempoAudioSourceWriteClock;

export function prepareTempoAudioSourceWrite(input: Input) {
    const promotion = input.promotion;
    const liveTracks = getTrackStoreState();
    const liveLanes = takeLaneStore.value;
    const tracks = liveTracks ? { ...liveTracks, tracks: input.owners?.tracks ?? liveTracks.tracks } : null;
    const lanes = liveLanes ? { ...liveLanes, lanes: input.owners?.lanes ?? liveLanes.lanes } : null;
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
    if (!captured || !tempoSourcePromotionsEqual(captured, promotion)) {
        return null;
    }
    const clock =
        'target' in input
            ? { target: input.target, ...(input.clockPath ? { clockPath: input.clockPath } : {}) }
            : { rowClock: input.rowClock };
    const intent = captureTempoAudioSourceWriteIntent({
        promotion,
        direction: input.direction,
        ...clock,
        context: { ...input.clock, tracks, takeLanes: lanes },
    });
    return intent ? { tracks, lanes, projected, intent } : null;
}
