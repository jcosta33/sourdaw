import { splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';

import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { type Clip } from '../../stores/trackStore';
import { snapToZeroCrossing } from '../timelineInteractions/snapToZeroCrossing';

/**
 * Split a clip at `splitBeat` (zero-crossing snapped for audio). The left half
 * keeps the original clip id; the right half gets a fresh id unless
 * `rightClipId` is provided — redo paths pass the id the original split
 * produced so stacked splits on the same lineage stay addressable. Returns the
 * right clip id, or null when the split is rejected.
 */
export function splitClip(clipId: string, splitBeat: number, rightClipId?: string): string | null {
    const state = getTrackState();
    if (!state) {
        return null;
    }

    let newRightClipId: string | null = null;
    let splitClipType: 'audio' | 'midi' | null = null;
    let adjustedSplit: number | null = null;

    const newTracks = state.tracks.map((time) => {
        const clip = time.clips.find((context) => context.id === clipId);
        if (!clip || splitBeat <= clip.startBeat || splitBeat >= clip.endBeat) {
            return time;
        }

        const adjustedSplitBeat = snapToZeroCrossing(clip, splitBeat);

        if (adjustedSplitBeat <= clip.startBeat || adjustedSplitBeat >= clip.endBeat) {
            return time;
        }

        const rightId = rightClipId ?? getNextClipId();
        newRightClipId = rightId;
        splitClipType = clip.type;
        adjustedSplit = adjustedSplitBeat;

        const leftClip: Clip = {
            ...clip,
            endBeat: adjustedSplitBeat,
            name: `${clip.name} (L)`,
            fadeOutBeats: 0,
        };

        const rightClip: Clip = {
            ...clip,
            id: rightId,
            name: `${clip.name} (R)`,
            startBeat: adjustedSplitBeat,
            endBeat: clip.endBeat,
            fadeInBeats: 0,
            fadeOutBeats: clip.fadeOutBeats,
            audioOffsetBeats: (clip.audioOffsetBeats ?? 0) + (adjustedSplitBeat - clip.startBeat),
        };

        return {
            ...time,
            clips: time.clips.map((context) => (context.id === clipId ? leftClip : context)).concat(rightClip),
        };
    });

    if (newRightClipId !== null) {
        setTrackState({
            ...state,
            tracks: newTracks,
        });

        // For MIDI clips the notes are keyed by clip id with absolute startBeat —
        // after trimming the source clip, any note past the split point would
        // become invisible. Partition the notes across the two clip ids so
        // every note stays visible and playable.
        if (splitClipType === 'midi' && adjustedSplit !== null) {
            splitMidiNotesAtBeat({
                sourceClipId: clipId,
                newClipId: newRightClipId,
                splitBeat: adjustedSplit,
            });
        }

        return newRightClipId;
    }

    return null;
}
