/**
 * The clips an alternative holds right now. The active alternative's clips are
 * the track's own `clips`: its stored copy is refreshed only when the user
 * switches or creates an alternative, so between those moments it is stale.
 * Every reader that means "what is in this alternative now" reads through here;
 * only the handlers that capture or restore the stored snapshot read
 * `alternative.clips` directly.
 */
export function getAlternativeClips<TClip>(
    track: { activeAlternativeId: string; clips: TClip[] },
    alternative: { id: string; clips: TClip[] }
): TClip[] {
    return alternative.id === track.activeAlternativeId ? track.clips : alternative.clips;
}

/**
 * Every clip a track holds right now: its own `clips` (which are the active
 * alternative's contents) plus each inactive alternative's stored clips. The
 * active alternative's stored copy is left out, so a clip is never counted
 * twice and a clip deleted from the track is never counted at all.
 */
export function getHeldClips<TClip>(track: {
    activeAlternativeId: string;
    clips: TClip[];
    alternatives: { id: string; clips: TClip[] }[];
}): TClip[] {
    return [
        ...track.clips,
        ...track.alternatives.flatMap((alternative) =>
            alternative.id === track.activeAlternativeId ? [] : alternative.clips
        ),
    ];
}
