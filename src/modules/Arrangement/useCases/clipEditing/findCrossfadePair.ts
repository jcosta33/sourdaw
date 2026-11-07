import { type Clip, type Track } from '../../models/Track';

/**
 * The two clips a crossfade can apply to. Fades belong to audio playback
 * (MIDI playback reads none), and a crossfade joins neighbours on one track,
 * so a MIDI clip or a pair across tracks yields `null`. The forward action and
 * its undo description both read this, so they refuse the same pairs.
 */
export function findCrossfadePair(
    tracks: readonly Track[],
    clipAId: string,
    clipBId: string
): { clipA: Clip; clipB: Clip } | null {
    const track = tracks.find((candidate) => candidate.clips.some((clip) => clip.id === clipAId));
    const clipA = track?.clips.find((clip) => clip.id === clipAId);
    const clipB = track?.clips.find((clip) => clip.id === clipBId);
    if (!clipA || !clipB || clipA.type !== 'audio' || clipB.type !== 'audio') {
        return null;
    }
    return { clipA, clipB };
}
