import { type ProjectContext } from '../models/ProjectContext';

/**
 * Whether a target has audio to measure: a track holding a clip, or a bus fed, through an output or a
 * send, by a track that does, however many buses deep. The visited set bounds a routing cycle.
 */
export function readTargetCarriesAudio(
    context: Pick<ProjectContext, 'tracks'>,
    targetId: string,
    visited: ReadonlySet<string> = new Set()
): boolean {
    if (visited.has(targetId)) {
        return false;
    }
    const target = context.tracks.find((track) => track.id === targetId);
    if (target === undefined) {
        return false;
    }
    if (target.clips.length > 0) {
        return true;
    }
    const seen = new Set(visited).add(targetId);
    return context.tracks.some(
        (source) =>
            (source.outputId === targetId || source.sends?.some((send) => send.busId === targetId) === true) &&
            readTargetCarriesAudio(context, source.id, seen)
    );
}
