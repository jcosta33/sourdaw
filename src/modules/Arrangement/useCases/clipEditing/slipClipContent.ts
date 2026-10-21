import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';
import { resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

import { updateClip } from '../updateClip';

/**
 * Slip clip content — slides internal content (audio or MIDI) within fixed boundaries.
 * Non-destructive: adjusts audioOffsetBeats (audio) or midiOffsetBeats (MIDI).
 * Note data and clip boundaries are untouched. Reports whether the write landed.
 *
 * A looped MIDI clip stores the offset's phase inside `[0, loopLength)` (the
 * same wrap the trim applies through the shared util) — a slip that crosses the
 * region end must not park a raw figure one loop away from the material, where
 * the anchored loop window drops every row and the clip plays total silence.
 *
 * The stored rows ride only a wrap that RAISES the figure (a negative slip
 * wrapping up to its positive representative): the rows shift by the same
 * distance so every `note.startBeat - midiOffsetBeats` relative keeps its
 * figure. A wrap that LOWERS the figure (a slip past the region end) must not
 * move the rows at all: the loop window is anchored to `startBeat -
 * loopOriginBeat`, which a slip never touches, so shifting the rows by the
 * wrap's distance would park them a whole loop below the unmoved window floor
 * — exactly the silence the wrap exists to prevent. The lowered figure alone
 * carries the phase, and the rows keep the relative figures that read inside
 * the window.
 */
export function slipClipContent(clipId: string, type: 'audio' | 'midi', newOffset: number): boolean {
    return updateClip(clipId, (context) => {
        if (type === 'audio') {
            return { ...context, audioOffsetBeats: newOffset };
        }
        const loopEnabled = context.loopEnabled ?? false;
        const midiOffsetBeats = resolveLoopedOffsetBeats({
            offsetBeats: newOffset,
            loopEnabled,
            clipDurationBeats: context.endBeat - context.startBeat,
            configuredLoopLengthBeats: context.loopLength,
        });
        if (loopEnabled && midiOffsetBeats > newOffset) {
            // The wrap lifted a negative figure to its positive phase; the
            // stored rows ride the same lift. A non-zero lift is the only
            // window-safe row shift a slip can carry.
            shiftClipMidiNotes(clipId, midiOffsetBeats - newOffset);
        }
        return { ...context, midiOffsetBeats };
    });
}
