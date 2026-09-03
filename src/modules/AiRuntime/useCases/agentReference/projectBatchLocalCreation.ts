import { type ProjectContext, type ProjectContextTrack } from '../../models/ProjectContext';

import { type BatchLocalCreatedTrackKind } from './batchLocalBindingProducers';

export type BatchLocalCreationProjection = {
    createdId: string;
    endBeat?: number;
    /** Present when the creation is a clip; names the track the clip is projected onto. */
    parentTrackId?: string;
    name: string;
    startBeat?: number;
    trackKind?: BatchLocalCreatedTrackKind;
};

function createProjectedTrack(
    context: ProjectContext,
    projection: BatchLocalCreationProjection,
    kind: BatchLocalCreatedTrackKind
): ProjectContextTrack {
    return {
        id: projection.createdId,
        name: projection.name,
        kind,
        muted: false,
        soloed: false,
        soloSafe: kind === 'bus',
        armed: false,
        frozen: false,
        gain: 1,
        pan: 0,
        automationMode: 'read',
        outputId: context.tracks.find((track) => track.kind === 'master')?.id,
        clipCount: 0,
        deviceCount: 0,
        clips: [],
        devices: [],
        sends: [],
    };
}

function projectCreatedClip(context: ProjectContext, projection: BatchLocalCreationProjection): ProjectContext {
    return {
        ...context,
        tracks: context.tracks.map((track) => {
            if (track.id !== projection.parentTrackId) {
                return track;
            }
            const clips = [
                ...track.clips,
                {
                    id: projection.createdId,
                    name: projection.name,
                    type: track.kind === 'midi' ? ('midi' as const) : ('audio' as const),
                    startBeat: projection.startBeat ?? 0,
                    endBeat: projection.endBeat ?? 0,
                    locked: false,
                    noteCount: 0,
                },
            ];
            return { ...track, clips, clipCount: clips.length };
        }),
    };
}

/**
 * Makes a plan-created object visible to every later concrete capability check in the same batch,
 * so a consumer is grounded against the object the plan will actually produce rather than against
 * a snapshot that predates it. The projected shape mirrors what the creating handler writes.
 */
export function projectBatchLocalCreation(
    context: ProjectContext,
    projection: BatchLocalCreationProjection
): ProjectContext {
    if (projection.trackKind === undefined) {
        return projectCreatedClip(context, projection);
    }
    return { ...context, tracks: [...context.tracks, createProjectedTrack(context, projection, projection.trackKind)] };
}
