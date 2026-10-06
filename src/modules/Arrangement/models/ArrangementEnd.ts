type ArrangementTrack = { clips: readonly { endBeat: number }[] };

/**
 * Where the arrangement ends: the beat its last clip ends on, or 0 for an arrangement holding no
 * clips. "Go to end" seeks here and a new loop region spans to here, so a range that runs to the
 * end of the project runs to the same beat.
 */
export function getArrangementEndBeat(tracks: readonly ArrangementTrack[]): number {
    let endBeat = 0;
    for (const track of tracks) {
        for (const clip of track.clips) {
            if (clip.endBeat > endBeat) {
                endBeat = clip.endBeat;
            }
        }
    }
    return endBeat;
}
