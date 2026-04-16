import { updateClip } from '../updateClip';

/**
 * Slip clip content — slides internal content (audio or MIDI) within fixed boundaries.
 * Non-destructive: adjusts audioOffsetBeats (audio) or midiOffsetBeats (MIDI).
 * Note data and clip boundaries are untouched.
 */
export function slipClipContent(clipId: string, type: 'audio' | 'midi', newOffset: number): void {
    updateClip(clipId, (c) => {
        if (type === 'audio') {
            return { ...c, audioOffsetBeats: newOffset };
        }
        return { ...c, midiOffsetBeats: newOffset };
    });
}
