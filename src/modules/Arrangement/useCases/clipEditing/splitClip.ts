import { getTrackState, setTrackState } from '#/modules/Arrangement/repositories/track';
import { type Clip } from '#/modules/Arrangement/models/Track';
import { getNextClipId } from '#/modules/Arrangement/repositories/clipIdCounter';
import { snapSplitBeatToZeroCrossing } from '#/modules/Arrangement/services/snapSplitBeatToZeroCrossing';

export function splitClip(clipId: string, splitBeat: number): void {
    const state = getTrackState();
    if (!state) {
        return;
    }

    setTrackState({
        ...state,
        tracks: state.tracks.map((t) => {
            const clip = t.clips.find((c) => c.id === clipId);
            if (!clip || splitBeat <= clip.startBeat || splitBeat >= clip.endBeat) {
                return t;
            }

            const adjustedSplitBeat = snapSplitBeatToZeroCrossing(clip, splitBeat);

            if (adjustedSplitBeat <= clip.startBeat || adjustedSplitBeat >= clip.endBeat) {
                return t;
            }

            const leftClip: Clip = {
                ...clip,
                endBeat: adjustedSplitBeat,
                name: `${clip.name} (L)`,
                fadeOutBeats: 0,
            };

            const rightClip: Clip = {
                ...clip,
                id: getNextClipId(),
                name: `${clip.name} (R)`,
                startBeat: adjustedSplitBeat,
                endBeat: clip.endBeat,
                fadeInBeats: 0,
                fadeOutBeats: clip.fadeOutBeats,
            };

            return {
                ...t,
                clips: t.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
            };
        }),
    });
}
