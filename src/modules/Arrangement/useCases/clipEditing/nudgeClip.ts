import { updateClip } from '../../repositories/track/updateClip';
import { shiftClipAutomation } from '#/modules/Automation/useCases';
import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';

export function nudgeClip(clipId: string, beats: number): void {
    let appliedDelta = 0;
    updateClip(clipId, (c) => {
        if (c.locked) {
            return c;
        }
        const newStart = Math.max(0, c.startBeat + beats);
        const duration = c.endBeat - c.startBeat;
        appliedDelta = newStart - c.startBeat;
        return { ...c, startBeat: newStart, endBeat: newStart + duration };
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
