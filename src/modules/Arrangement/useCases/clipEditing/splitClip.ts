import { splitMidiNotesAtBeat } from '#/modules/MIDI/useCases';

import { getNextClipId } from '../../repositories/clipIdCounter';
import { getTrackState } from '../../repositories/track/getTrackState';
import { setTrackState } from '../../repositories/track/setTrackState';
import { resolveEligibleClipWriteTarget } from '../../stores/resolveEligibleClipWriteTarget';
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
    if (!Number.isFinite(splitBeat)) {
        return null;
    }
    if (rightClipId !== undefined && (typeof rightClipId !== 'string' || rightClipId.length === 0)) {
        return null;
    }

    const resolution = resolveEligibleClipWriteTarget({ clipId });
    if (resolution.status !== 'eligible') {
        return null;
    }

    const state = getTrackState();
    if (!state) {
        return null;
    }
    if (rightClipId !== undefined) {
        const destinationIdIsUsed = state.tracks.some((track) => {
            if (track.clips.some((context) => context.id === rightClipId)) {
                return true;
            }

            return track.alternatives.some((alternative) =>
                alternative.clips.some((context) => context.id === rightClipId)
            );
        });
        if (destinationIdIsUsed) {
            return null;
        }
    }

    let newRightClipId: string | null = null;
    let splitClipType: 'audio' | 'midi' | null = null;
    let adjustedMediaSplit: number | null = null;

    const newTracks = state.tracks.map((time) => {
        if (time.id !== resolution.trackId) {
            return time;
        }

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
        // MIDI notes are stored clip-relative (playback =
        // clip.startBeat + note.startBeat - midiOffsetBeats), so the note
        // partition must happen in clip-media beats, not timeline beats.
        adjustedMediaSplit = adjustedSplitBeat - clip.startBeat + (clip.midiOffsetBeats ?? 0);

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
            // Right-side notes are re-based onto this clip at split time, so
            // its MIDI media starts at the split point.
            midiOffsetBeats: 0,
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

        // For MIDI clips the notes are keyed by clip id, clip-relative —
        // after trimming the source clip, any note past the split point would
        // become invisible. Partition the notes across the two clip ids so
        // every note stays visible and playable.
        if (splitClipType === 'midi' && adjustedMediaSplit !== null) {
            splitMidiNotesAtBeat({
                sourceClipId: clipId,
                newClipId: newRightClipId,
                splitBeat: adjustedMediaSplit,
            });
        }

        return newRightClipId;
    }

    return null;
}
