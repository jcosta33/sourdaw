import { shiftClipAutomation } from '#/modules/Automation/useCases';

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

    // Clip-scoped automation is stored at timeline-absolute beats and must
    // follow the rectangle. MIDI notes are stored clip-relative and follow
    // automatically — shifting them here double-moved every note (same
    // re-validation finding as moveClip, ledger M-025 family).
    if (didWrite && appliedDelta !== 0) {
        shiftClipAutomation(clipId, appliedDelta);
    }

    return didWrite;
}
