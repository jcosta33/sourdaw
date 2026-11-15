import { type AppAction } from '#/utils/handlerContract';

import { type ProjectContextTrack } from '../../models/ProjectContext';

import { type MaterializationState, type MaterializationStep } from './MaterializationState';

/** Pins an action to the state of the track it names, or rejects it when the track is not projected. */
export function guardTrackAction(
    state: MaterializationState,
    trackId: string,
    guard: (track: ProjectContextTrack) => AppAction
): MaterializationStep {
    const track = state.tracksById.get(trackId);
    if (!track) {
        return { status: 'rejected', reason: `Track is unavailable: ${trackId}` };
    }
    return { status: 'accepted', actions: [guard(track)] };
}
