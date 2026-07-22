import { shiftClipAutomation } from '#/modules/Automation/useCases';
import { shiftClipMidiNotes } from '#/modules/MIDI/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

export function nudgeClip(clipId: string, beats: number): boolean {
    if (!Number.isFinite(beats)) {
        return false;
    }

    try {
        const state = getTrackState();
        if (state) {
            const target = findClipById({ clipId, tracks: state.tracks });
            if (target?.clip.locked) {
                return false;
            }
        }
    } catch {
        return false;
    }

    let appliedDelta = 0;
    const didWrite = updateClip(clipId, (context) => {
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
    if (didWrite && appliedDelta !== 0) {
        shiftClipMidiNotes(clipId, appliedDelta);
        shiftClipAutomation(clipId, appliedDelta);
    }

    return didWrite;
}
