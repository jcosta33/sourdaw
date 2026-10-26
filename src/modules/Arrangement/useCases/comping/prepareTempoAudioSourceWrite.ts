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
    let before: { readonly tracks: readonly Track[]; readonly lanes: readonly TakeLane[] };
    if (input.direction === 'promote') {
        before = { tracks: tracks?.tracks ?? [], lanes: lanes?.lanes ?? [] };
    } else {
        before = projected;
    }
    const captured = captureTempoAudioSources(before.tracks, before.lanes, input.timeline);
    if (!captured || !tempoSourcePromotionsEqual(captured, promotion)) {
        return null;
    }
    let intent: ReturnType<typeof captureTempoAudioSourceWriteIntent> | null;
    if ('target' in input) {
        const clock: { target: typeof input.target; clockPath?: typeof input.clockPath } = {
            target: input.target,
        };
        if (input.clockPath) {
            clock.clockPath = input.clockPath;
        }
        const writeInput = {
            promotion,
            direction: input.direction,
            ...clock,
            context: { ...input.clock, tracks, takeLanes: lanes },
        };
        intent = captureTempoAudioSourceWriteIntent(writeInput);
    } else {
        const clock = { rowClock: input.rowClock };
        const writeInput = {
            promotion,
            direction: input.direction,
            ...clock,
            context: { ...input.clock, tracks, takeLanes: lanes },
        };
        intent = captureTempoAudioSourceWriteIntent(writeInput);
    }
    return intent ? { tracks, lanes, projected, intent } : null;
}
