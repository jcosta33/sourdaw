import { getTrackState } from '../../repositories/track/getTrackState';
import { updateTrack } from '../../repositories/track/updateTrack';
import { type Clip } from '../../models/Track';
import { getNextClipId } from '../../repositories/clipIdCounter';

export function glueClips(clipIds: string[]): void {
    const state = getTrackState();
    if (!state || clipIds.length < 2) {
        return;
    }
    const firstTrack = state.tracks.find((t) => t.clips.some((c) => clipIds.includes(c.id)));
    if (!firstTrack) {
        return;
    }
    const clips = firstTrack.clips.filter((c) => clipIds.includes(c.id));
    if (clips.length < 2) {
        return;
    }
    let startBeat = Infinity;
    let endBeat = -Infinity;
    for (const c of clips) {
        if (c.startBeat < startBeat) { startBeat = c.startBeat; }
        if (c.endBeat > endBeat) { endBeat = c.endBeat; }
    }
    const glued: Clip = {
        id: getNextClipId(),
        trackId: firstTrack.id,
        name: `${clips[0]!.name} (glued)`,
        startBeat,
        endBeat,
        type: clips[0]!.type,
        fadeInBeats: clips[0]!.fadeInBeats,
        fadeOutBeats: clips[clips.length - 1]!.fadeOutBeats,
        gain: 1.0,
        color: clips[0]!.color,
        locked: false,
        muted: false,
    };
    updateTrack(firstTrack.id, (t) => ({
        ...t,
        clips: [...t.clips.filter((c) => !clipIds.includes(c.id)), glued],
    }));
}
