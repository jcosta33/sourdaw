import { type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';
import {
    isTempoAudioSourcePromotion,
    tempoSourcePromotionsEqual,
    type TempoSourceClockPath,
} from '#/utils/tempoAudioSourcePromotion';

import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Track } from '../../models/Track';
import { type TakeLane } from '../../models/TakeLane';
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
    readonly owners?: { readonly tracks: readonly Track[]; readonly lanes: readonly TakeLane[] };
    readonly clockPath?: TempoSourceClockPath;
};

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
    const intent = captureTempoAudioSourceWriteIntent({
        promotion,
        direction: input.direction,
        target: input.target,
        context: { ...input.clock, tracks, takeLanes: lanes },
        clockPath: input.clockPath,
    });
    return intent ? { tracks, lanes, projected, intent } : null;
}
