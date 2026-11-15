import { type ProjectContext } from '../models/ProjectContext';

/** The clip with this id on any track of the planning snapshot. */
export function findContextClip(
    context: ProjectContext,
    clipId: string
): ProjectContext['tracks'][number]['clips'][number] | undefined {
    return context.tracks.flatMap((track) => track.clips).find((candidate) => candidate.id === clipId);
}
