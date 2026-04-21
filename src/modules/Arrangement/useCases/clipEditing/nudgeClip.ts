import { shiftClipAutomation } from '#/modules/Automation/useCases';
import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';

import { updateClip } from '../../repositories/track/updateClip';

export function nudgeClip(clipId: string, beats: number): void {
    let appliedDelta = 0;
    updateClip(clipId, (context) => {
        if (context.locked) {
            return context;
        }
        const newStart = Math.max(0, context.startBeat + beats);
        const duration = context.endBeat - context.startBeat;
        appliedDelta = newStart - context.startBeat;
        return { ...context, startBeat: newStart, endBeat: newStart + duration };
    });

    // Notes and automation are indexed per clip with absolute beat positions —
    // shifting the clip rectangle without shifting them desyncs playback from
    // the visual arrangement. `moveClip` already does this for drags; nudges
    // need the same follow-through.
    if (appliedDelta !== 0) {
        shiftClipMidiNotes(clipId, appliedDelta);
        shiftClipAutomation(clipId, appliedDelta);
    }
}
