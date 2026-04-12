import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../stores/trackStore';
import { getNextClipId } from '../../repositories/clipIdCounter';
import { snapSplitBeatToZeroCrossing } from '../../services/snapSplitBeatToZeroCrossing';

export function splitClip(clipId: string, splitBeat: number): string | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    let splitOccurred = false;
    const newTracks = state.tracks.map((t) => {
        const clip = t.clips.find((c) => c.id === clipId);
        if (!clip || splitBeat <= clip.startBeat || splitBeat >= clip.endBeat) {
            return t;
        }

        const adjustedSplitBeat = snapSplitBeatToZeroCrossing(clip, splitBeat);

        if (adjustedSplitBeat <= clip.startBeat || adjustedSplitBeat >= clip.endBeat) {
            return t;
        }

        splitOccurred = true;
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
            audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (adjustedSplitBeat - clip.startBeat),
        };

        return {
            ...t,
            clips: t.clips.map((c) => (c.id === clipId ? leftClip : c)).concat(rightClip),
        };
    });

    if (splitOccurred) {
        setTrackState({
            ...state,
            tracks: newTracks,
        });
    }
}
