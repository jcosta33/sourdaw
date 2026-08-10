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
        if (action.type === 'automateSendRange') {
            const bus = tracksById.get(action.payload.busId);
            if (!bus || bus.kind !== 'bus') {
                return { status: 'rejected', reason: `Bus is unavailable: ${action.payload.busId}` };
            }
            const section = (context.sections ?? []).find(
                (candidate) => candidate.name.toLocaleLowerCase() === action.payload.sectionName.toLocaleLowerCase()
            );
            if (!section) {
                return { status: 'rejected', reason: `Section is unavailable: ${action.payload.sectionName}` };
            }
            const expectedSends = [];
            for (const trackId of action.payload.trackIds) {
                const track = tracksById.get(trackId);
                const send = track?.sends?.find((candidate) => candidate.busId === action.payload.busId);
                if (!track || !send) {
                    return {
                        status: 'rejected',
                        reason: `Send is unavailable: ${trackId} -> ${action.payload.busId}`,
                    };
                }
                expectedSends.push({ trackId, level: send.level, preFader: send.preFader });
            }
            materialized.push({
                type: 'automateSendRange',
                payload: {
                    ...action.payload,
                    busName: bus.name,
                    sectionId: section.id,
                    startBeat: section.startBeat,
                    endBeat: section.endBeat,
                    expectedSends,
                    expectedSection: {
                        name: section.name,
                        startBeat: section.startBeat,
                        endBeat: section.endBeat,
                    },
                },
            });
            continue;
        }
        materialized.push(action);
    }

    return { status: 'accepted', actions: materialized };
}
