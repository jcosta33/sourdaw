import { type PendingWorkletEvent } from './types';

/**
 * Order of the four kinds at one instant, and the reason each precedes the next.
 *
 * A controller comes first so a note struck on the same frame sounds under the
 * pedal or controller it was recorded with: live playback posts a clip's
 * controllers before its notes, and the engines apply a frame's events in the
 * order they arrive. A release follows so a re-trigger at the same pitch and
 * frame does not cut the voice it just started. Expression comes last because
 * the engines address a voice still held on the member channel: an update sorted
 * ahead of its own note-on addresses nothing and the note sounds unexpressed.
 */
const EVENT_ORDER: Record<PendingWorkletEvent['type'], number> = { control: 0, off: 1, on: 2, expression: 3 };

export function comparePendingWorkletEvents(alpha: PendingWorkletEvent, beta: PendingWorkletEvent): number {
    const timeDifference = alpha.time - beta.time;
    if (timeDifference !== 0) {
        return timeDifference;
    }
    return EVENT_ORDER[alpha.type] - EVENT_ORDER[beta.type];
}
