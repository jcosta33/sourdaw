import { shiftClipAutomation } from '#/modules/Automation/useCases';

import { type Clip } from '../../models/Track';
import { getTrackState } from '../../repositories/track/getTrackState';
import { updateClip } from '../../repositories/track/updateClip';
import { findClipById } from '../../services/findClipById';

import { planClipNudge } from './planClipNudge';
import { type ClipPlacement } from './readClipPlacement';

function placeClip(clip: Clip, placement: ClipPlacement): Clip {
    const placed = { ...clip, startBeat: placement.startBeat, endBeat: placement.endBeat };
    // Clip objects carry an optional anchor either present or absent, never `undefined`.
    if (placement.loopOriginBeat === undefined) {
        delete placed.loopOriginBeat;
    } else {
        placed.loopOriginBeat = placement.loopOriginBeat;
    }
    if (placement.audioLoopPassOriginBeat === undefined) {
        delete placed.audioLoopPassOriginBeat;
    } else {
        placed.audioLoopPassOriginBeat = placement.audioLoopPassOriginBeat;
    }
    return placed;
}

export function nudgeClip(clipId: string, beats: number, placement?: ClipPlacement): boolean {
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
        // The nudge is a relocation, not a trim: the loop anchor moves with
        // the rectangle so the applied delta (clamped at zero) never re-derives
        // the loop window or the pass count from the new placement (#4988).
        const planned = planClipNudge(context, beats, placement);
        appliedDelta = planned.startBeat - context.startBeat;
        return placeClip(context, planned);
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
