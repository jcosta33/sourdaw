import { SAME_FRAME_EVENT_ORDER } from '#/utils/sameFrameEventOrder';

import { type PendingWorkletEvent } from './types';

/**
 * Pending events sort by time, then by `SAME_FRAME_EVENT_ORDER`: release, a stored
 * controller on a clip's closing line, any other stored controller, note-on,
 * expression. The table is shared with live scheduling so a
 * pedal pressed on the frame a note ends catches that note in neither route (the
 * release is applied first), and a pedal or controller on the frame a note starts
 * applies to it in both. A time tie within one kind keeps insertion order (the
 * sort is stable), which is the performer order the engines expect.
 */
export function comparePendingWorkletEvents(alpha: PendingWorkletEvent, beta: PendingWorkletEvent): number {
    const timeDifference = alpha.time - beta.time;
    if (timeDifference !== 0) {
        return timeDifference;
    }
    return SAME_FRAME_EVENT_ORDER[alpha.type] - SAME_FRAME_EVENT_ORDER[beta.type];
}
