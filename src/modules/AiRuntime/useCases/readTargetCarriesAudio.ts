import { type ProjectContext } from '../models/ProjectContext';

/**
 * Whether a target may have audio to measure; false only when it is proven silent. A track holding a
 * clip carries audio, and so does a folder, whose children reach it through a parent link this context
 * does not carry. A bus carries audio when a track that does feeds it, through an output or a send,
 * however many buses deep. The visited set bounds a routing cycle. Reading silence wrongly drops the
 * recipe's goals and admits an unverified change, while reading audio wrongly only shows a silent
 * preview that blocks Confirm, so every unknown resolves to audio.
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
    if (target.kind === 'folder' || target.clips.length > 0) {
        return true;
    }
    const seen = new Set(visited).add(targetId);
    return context.tracks.some(
        (source) =>
            (source.outputId === targetId || source.sends?.some((send) => send.busId === targetId) === true) &&
            readTargetCarriesAudio(context, source.id, seen)
    );
}
