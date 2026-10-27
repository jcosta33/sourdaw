import { prepareClipMidiRowCoordinateShift } from '#/modules/MIDI/useCases';
import { resolveLoopedOffsetBeats } from '#/utils/clipLoopOrigin';

import { updateClip } from '../updateClip';

import { slipWrapRowLiftBeats } from './slipWrapRowLiftBeats';

/**
 * Slip clip content — slides internal content (audio or MIDI) within fixed boundaries.
 * Non-destructive: adjusts audioOffsetBeats (audio) or midiOffsetBeats (MIDI).
 * Clip boundaries stay fixed; a raising MIDI wrap translates stored coordinates.
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
    inverseRowShiftBeats?: number,
    rowCoordinates?: {
        restore?: unknown;
        refused?: boolean;
        capture?: Extract<ReturnType<typeof prepareClipMidiRowCoordinateShift>, { status: 'prepared' }>['capture'];
    }
): boolean {
    if (type === 'audio') {
        return updateClip(clipId, (context) => ({ ...context, audioOffsetBeats: newOffset }));
    }
    const refused = new Error('The complete MIDI coordinate shift could not be applied');
    let capture:
        Extract<ReturnType<typeof prepareClipMidiRowCoordinateShift>, { status: 'prepared' }>['capture'] | undefined;
    try {
        const didWrite = updateClip(clipId, (context) => {
            const loopEnabled = context.loopEnabled ?? false;
            const clipDurationBeats = context.endBeat - context.startBeat;
            const wrappedOffsetBeats = resolveLoopedOffsetBeats({
                offsetBeats: newOffset,
                loopEnabled,
                clipDurationBeats,
                configuredLoopLengthBeats: context.loopLength,
            });
            // Captured inverse offsets restore verbatim; fresh slips retain the
            // existing asymmetric wrap law and lift rows only when phase rises.
            const midiOffsetBeats = inverseRowShiftBeats !== undefined ? newOffset : wrappedOffsetBeats;
            const beatDelta =
                inverseRowShiftBeats ??
                slipWrapRowLiftBeats({
                    loopEnabled,
                    clipDurationBeats,
                    configuredLoopLengthBeats: context.loopLength,
                    offsetBeats: newOffset,
                });
            if (!Number.isFinite(midiOffsetBeats)) {
                throw refused;
            }
            const plan = prepareClipMidiRowCoordinateShift({ clipId, beatDelta, restore: rowCoordinates?.restore });
            if (plan.status === 'refused' || !plan.apply()) {
                throw refused;
            }
            capture = plan.capture;
            return { ...context, midiOffsetBeats };
        });
        if (didWrite && rowCoordinates && capture) {
            rowCoordinates.capture = capture;
        }
        return didWrite;
    } catch (error) {
        if (error === refused) {
            if (rowCoordinates) {
                rowCoordinates.refused = true;
            }
            return false;
        }
        throw error;
    }
}
