import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';
import { resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

import { updateClip } from '../updateClip';

import { slipWrapRowLiftBeats } from './slipWrapRowLiftBeats';

/**
 * Slip clip content — slides internal content (audio or MIDI) within fixed boundaries.
 * Non-destructive: adjusts audioOffsetBeats (audio) or midiOffsetBeats (MIDI).
 * Note data and clip boundaries are untouched. Reports whether the write landed.
 *
 * A looped MIDI clip stores the offset's phase inside `[0, loopLength)` (the
 * same wrap the trim applies through the shared util) — a slip that crosses the
 * region end must not park a raw figure one loop away from the material, where
 * the anchored loop window drops every row and the clip plays total silence.
 * The wrap is a forward-write law: a recorded inverse restores its captured
 * figure verbatim (a restoration, not a fresh slip), so a capture that is not
 * a phase of the loop config at replay time comes back exactly as captured.
 * Every reader consumes the offset through `note.startBeat - midiOffsetBeats`
 * relatives and re-wraps on the next forward write.
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
export function slipClipContent(
    clipId: string,
    type: 'audio' | 'midi',
    newOffset: number,
    inverseRowShiftBeats?: number
): boolean {
    return updateClip(clipId, (context) => {
        if (type === 'audio') {
            return { ...context, audioOffsetBeats: newOffset };
        }
        const loopEnabled = context.loopEnabled ?? false;
        const clipDurationBeats = context.endBeat - context.startBeat;
        // The recorded-inverse leg restores the captured figure verbatim: it is
        // a restoration of the state the entry captured, not a fresh slip to
        // re-wrap. A captured figure that is not a phase of the loop config at
        // replay time — a legacy raw offset, or a phase a later loop-length
        // change de-phased — would wrap to a different offset and the undo
        // would write a state the pre-action clip never carried. The wrap stays
        // a forward-write law: the next fresh slip wraps its own offset anyway,
        // and every reader consumes the offset through
        // `note.startBeat - midiOffsetBeats` relatives, never as a phase.
        const midiOffsetBeats =
            inverseRowShiftBeats !== undefined
                ? newOffset
                : resolveLoopedOffsetBeats({
                      offsetBeats: newOffset,
                      loopEnabled,
                      clipDurationBeats,
                      configuredLoopLengthBeats: context.loopLength,
                  });
        const rowLiftBeats = slipWrapRowLiftBeats({
            loopEnabled,
            clipDurationBeats,
            configuredLoopLengthBeats: context.loopLength,
            offsetBeats: newOffset,
        });
        if (inverseRowShiftBeats !== undefined) {
            // A recorded inverse carries its own row restoration — the un-lift
            // of the raising wrap the forward slip applied (#5198). The
            // verbatim offset above plus the recorded shift is the whole
            // replay: the captured state, byte-exact. Entries recorded before
            // the field existed decode without it and take the forward law,
            // which for their offset-only inverses moves no rows — the
            // pre-anchor behavior exactly.
            shiftClipMidiNotes(clipId, inverseRowShiftBeats);
        } else if (rowLiftBeats !== 0) {
            // The wrap lifted a negative figure to its positive phase; the
            // stored rows ride the same lift. A non-zero lift is the only
            // window-safe row shift a slip can carry.
            shiftClipMidiNotes(clipId, rowLiftBeats);
        }
        return { ...context, midiOffsetBeats };
    });
}
