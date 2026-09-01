import { type PendingWorkletEvent } from './types';

/**
 * Order of the three kinds at one instant, and the reason each precedes the next.
 *
 * A release comes first so a re-trigger at the same pitch and frame does not cut
 * the voice it just started. Expression comes last because the engines address a
 * voice still held on the member channel: an update sorted ahead of its own
 * note-on addresses nothing and the note sounds unexpressed.
 */
const EVENT_ORDER: Record<PendingWorkletEvent['type'], number> = { off: 0, on: 1, expression: 2 };

export function comparePendingWorkletEvents(alpha: PendingWorkletEvent, beta: PendingWorkletEvent): number {
    const timeDifference = alpha.time - beta.time;
    if (timeDifference !== 0) {
        return timeDifference;
    }
    return EVENT_ORDER[alpha.type] - EVENT_ORDER[beta.type];
}
