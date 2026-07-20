import { type PendingWorkletEvent } from './types';

export function comparePendingWorkletEvents(alpha: PendingWorkletEvent, beta: PendingWorkletEvent): number {
    const timeDifference = alpha.time - beta.time;
    if (timeDifference !== 0) {
        return timeDifference;
    }
    if (alpha.type === beta.type) {
        return 0;
    }
    if (alpha.type === 'off') {
        return -1;
    }
    return 1;
}
