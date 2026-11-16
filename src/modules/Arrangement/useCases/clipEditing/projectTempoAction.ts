import {
    projectTempoSourceClock,
    isTempoAudioSourcePromotion,
    tempoSourcePromotionsEqual,
} from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { projectTempoAudioSources } from '../../stores/tempoAudioSources';
import { captureCurrentTempoAudioSources } from '../comping/captureCurrentTempoAudioSources';

import { capturedTimeline } from './capturedTimeline';
import { type ShiftedOwnerState } from './ShiftedOwnerState';

export function projectTempoAction(
    action: Extract<AppAction, { type: 'setTempo' | 'restoreTempoEdit' }>,
    state: ShiftedOwnerState
): ShiftedOwnerState | null {
    const { tempoChangeId, expectedBpm, bpm, audioSourcePromotion } = action.payload;
    if (
        !state.tracks ||
        tempoChangeId === undefined ||
        expectedBpm === undefined ||
        !isTempoAudioSourcePromotion(audioSourcePromotion)
    ) {
        return null;
    }
    if (action.type === 'setTempo' && bpm === expectedBpm) {
        return state;
    }
    const nextClock = projectTempoSourceClock(state.clock, [{ tempoChangeId, expectedBpm, bpm }]);
    if (!nextClock) {
        return null;
    }
    const direction = action.type === 'restoreTempoEdit' ? action.payload.sourceDirection : 'promote';
    const projected = projectTempoAudioSources(state.tracks, state.takeLanes, audioSourcePromotion, direction);
    if (!projected) {
        return null;
    }
    const originalTimeline = direction === 'promote' ? state.timeline : capturedTimeline(nextClock);
    const recaptured = captureCurrentTempoAudioSources(
        direction === 'promote' ? state.tracks : projected.tracks,
        direction === 'promote' ? state.takeLanes : projected.lanes,
        originalTimeline
    );
    if (!recaptured || !tempoSourcePromotionsEqual(recaptured, audioSourcePromotion)) {
        return null;
    }
    return {
        ...state,
        tracks: projected.tracks,
        takeLanes: projected.lanes,
        clips: projected.tracks.flatMap((track) => track.clips.map((clip) => ({ owningTrackId: track.id, clip }))),
        clock: nextClock,
        timeline: capturedTimeline(nextClock),
    };
}
