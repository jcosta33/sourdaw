import { getHeldClips as readHeldClips } from '../models/TrackAlternativeClips';

/**
 * Every clip a track holds right now: its own `clips` plus each inactive
 * alternative's stored clips. The shapes are structural so foreign modules
 * keep their own track and clip types.
 */
export function getHeldClips<TClip>(track: {
    activeAlternativeId: string;
    clips: TClip[];
    alternatives: { id: string; clips: TClip[] }[];
}): TClip[] {
    return readHeldClips(track);
}
