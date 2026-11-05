import { getAlternativeClips as readAlternativeClips } from '../models/TrackAlternativeClips';

/**
 * The clips an alternative holds right now: the track's own `clips` for the
 * active alternative (its stored copy is stale between switches), the stored
 * clips otherwise. The shapes are structural so foreign modules keep their own
 * track and clip types.
 */
export function getAlternativeClips<TClip>(
    track: { activeAlternativeId: string; clips: TClip[] },
    alternative: { id: string; clips: TClip[] }
): TClip[] {
    return readAlternativeClips(track, alternative);
}
