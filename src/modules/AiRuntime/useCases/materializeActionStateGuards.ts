import { type AppAction } from '#/utils/handlerContract';

import { type MaterializableRuntimeAction } from '../models/ExecutableRuntimeAction';

import { type ProjectContext } from './getProjectContext';

type MaterializeActionStateGuardsResult =
    { status: 'accepted'; actions: AppAction[] } | { status: 'rejected'; reason: string };

export function materializeActionStateGuards(
    actions: readonly MaterializableRuntimeAction[],
    context: ProjectContext
): MaterializeActionStateGuardsResult {
    const tracksById = new Map(context.tracks.map((track) => [track.id, track]));
    const materialized: AppAction[] = [];

    for (const action of actions) {
        if (action.type === 'setTrackGain') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'setTrackGain',
                payload: { ...action.payload, expectedGain: track.gain },
            });
            continue;
        }
        if (action.type === 'setTrackPan') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'setTrackPan',
                payload: { ...action.payload, expectedPan: track.pan },
            });
            continue;
        }
        if (action.type === 'muteTrack') {
            const track = tracksById.get(action.payload.trackId);
            if (!track) {
                return { status: 'rejected', reason: `Track is unavailable: ${action.payload.trackId}` };
            }
            materialized.push({
                type: 'muteTrack',
                payload: { ...action.payload, expectedMuted: track.muted },
            });
            continue;
        }
        materialized.push(action);
    }

    return { status: 'accepted', actions: materialized };
}
