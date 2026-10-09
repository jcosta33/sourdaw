import { shiftClipAutomation } from '#/modules/Automation/useCases';

import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';
import { applyTakeReKeyTransitions } from '../comping/applyTakeReKeyTransitions';
import { captureClipMoveTakeReKeyTransitions } from '../comping/captureClipMoveTakeReKey';

export function nudgeClip(clipId: string, beats: number): boolean {
    if (!Number.isFinite(beats)) {
        return false;
    }

    let original: ReturnType<typeof findClipById> = null;
    try {
        const state = getTrackState();
        if (state) {
            original = findClipById({ clipId, tracks: state.tracks });
            if (original?.clip.locked) {
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
        // #5100 — a nudge is a same-host move: the comped clip's takes and
        // comp regions re-key onto the applied (post-clamp) span, and the
        // inverse nudge re-enters here with the negated delta to restore them.
        if (original) {
            const takeReKeyTransitions = captureClipMoveTakeReKeyTransitions({
                trackId: original.trackId,
                clipId,
                fromStartBeat: original.clip.startBeat,
                fromEndBeat: original.clip.endBeat,
                toStartBeat: original.clip.startBeat + appliedDelta,
                toEndBeat: original.clip.endBeat + appliedDelta,
            });
            if (takeReKeyTransitions.length > 0) {
                applyTakeReKeyTransitions(takeReKeyTransitions);
            }
        }
    }

    return didWrite;
}
