import { updateClip } from '../updateClip';

/**
 * Slip clip content — slides internal content (audio or MIDI) within fixed boundaries.
 * Non-destructive: adjusts audioOffsetBeats (audio) or midiOffsetBeats (MIDI).
 * Note data and clip boundaries are untouched. Reports whether the write landed.
 */
export function slipClipContent(clipId: string, type: 'audio' | 'midi', newOffset: number): boolean {
    return updateClip(clipId, (context) => {
        if (type === 'audio') {
            return { ...context, audioOffsetBeats: newOffset };
        }
        return { ...context, midiOffsetBeats: newOffset };
    });
}
