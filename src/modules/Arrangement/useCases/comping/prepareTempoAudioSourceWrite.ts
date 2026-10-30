import { type TempoAudioSourcePromotionSnapshot } from '#/utils/handlerContract';
import { isTempoAudioSourcePromotion, tempoSourcePromotionsEqual } from '#/utils/tempoAudioSourcePromotion';

import { type TakeLane } from '../../models/TakeLane';
import { type TempoTimeline } from '../../models/TempoTimeline';
import { type Track } from '../../models/Track';
import { takeLaneStore } from '../../stores/takeLaneStore';
import { projectTempoAudioSources } from '../../stores/tempoAudioSources';
import {
    captureTempoAudioSourceWriteIntent,
    type TempoAudioSourceWriteClock,
} from '../../stores/tempoAudioSourceWriteIntent';
import { getTrackStoreState } from '../getTrackStoreState';

import { captureCurrentTempoAudioSources } from './captureCurrentTempoAudioSources';
import { captureDeferredTempoRecordings } from './captureDeferredTempoRecordings';

type Input = {
    readonly promotion: TempoAudioSourcePromotionSnapshot;
    readonly direction: 'promote' | 'restore';
    /** The original, pre-edit map. Neither callback is persisted. */
    readonly timeline: TempoTimeline;
    readonly clock: { readonly transport: unknown; readonly tempoMap: unknown };
    readonly owners?: { readonly tracks: readonly Track[]; readonly lanes: readonly TakeLane[] };
} & TempoAudioSourceWriteClock;

function capturePreparedTempoSourceIntent(
    input: Input,
    tracks: { readonly tracks: readonly Track[] } | null,
    lanes: { readonly lanes: readonly TakeLane[] } | null
) {
    const promotion = input.promotion;
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
        return captureTempoAudioSourceWriteIntent(writeInput);
    } else {
        const clock = { rowClock: input.rowClock };
        const writeInput = {
            promotion,
            direction: input.direction,
            ...clock,
            context: { ...input.clock, tracks, takeLanes: lanes },
        };
        return captureTempoAudioSourceWriteIntent(writeInput);
    }
}

export function prepareTempoAudioSourceWrite(input: Input) {
    const promotion = input.promotion;
    const liveTracks = getTrackStoreState();
    const liveLanes = takeLaneStore.value;
    const tracks = liveTracks ? { ...liveTracks, tracks: input.owners?.tracks ?? liveTracks.tracks } : null;
    const lanes = liveLanes ? { ...liveLanes, lanes: input.owners?.lanes ?? liveLanes.lanes } : null;
    if (!isTempoAudioSourcePromotion(promotion)) {
        return null;
    }
    const sourceTracks = tracks?.tracks ?? [];
    const sourceLanes = lanes?.lanes ?? [];
    const projected = projectTempoAudioSources(sourceTracks, sourceLanes, promotion, input.direction);
    if (!projected) {
        return null;
    }
    let before: { readonly tracks: readonly Track[]; readonly lanes: readonly TakeLane[] };
    if (input.direction === 'promote') {
        before = { tracks: sourceTracks, lanes: sourceLanes };
    } else {
        before = projected;
    }
    const captured = captureCurrentTempoAudioSources(before.tracks, before.lanes, input.timeline);
    if (!captured || !tempoSourcePromotionsEqual(captured, promotion)) {
        return null;
    }
    const intent = capturePreparedTempoSourceIntent(input, tracks, lanes);
    const deferred = captureDeferredTempoRecordings(sourceTracks, sourceLanes);
    if (!intent) {
        return null;
    }
    return {
        tracks,
        lanes,
        projected,
        intent: { ...intent, deferredRecordingSources: deferred.sources },
        stillOwnsDeferredRecordings: deferred.stillOwns,
        deferredRecordingClipIds: [...deferred.clipIds],
    };
}
