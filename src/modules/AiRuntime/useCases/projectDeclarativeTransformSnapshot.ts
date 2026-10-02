import { type compileDeclarativeTransform } from '#/modules/Command/useCases';

import { type ProjectContext } from '../models/ProjectContext';

type TransformSnapshot = Parameters<typeof compileDeclarativeTransform>[1];

/** Copy the planning read model once, with the revision captured immediately before that read. */
export function projectDeclarativeTransformSnapshot(context: ProjectContext, revision: string): TransformSnapshot {
    return {
        revision,
        tempo: context.tempo,
        timeSignature: [context.timeSignature[0], context.timeSignature[1]],
        tracks: context.tracks.map((track) => ({
            id: track.id,
            name: track.name,
            contentType: track.kind === 'audio' || track.kind === 'midi' ? track.kind : null,
            clips: track.clips.map((clip) => ({
                id: clip.id,
                name: clip.name,
                startBeat: clip.startBeat,
                endBeat: clip.endBeat,
            })),
        })),
    };
}
