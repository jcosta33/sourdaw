import { toasterStore } from '../stores/toasterStore';

import { disposeToasterDevice } from './disposeToasterDevice';
import { activeNoteRepeatSessions } from './noteRepeatState';
import { activeSessions } from './sixteenLevels';
import { padPending } from './toasterParamBridge/toasterPadParamQueue';

/**
 * Ends every Toaster device of the outgoing project at a project switch.
 *
 * The engine's graph reset announces no removal, because a reset that rebuilds
 * the same project keeps its devices. A switch is where they leave, so the
 * project boundary disposes each one here: without it a 16-Levels or
 * note-repeat session would outlive its project and attach to a reopened
 * device that reuses the id.
 */
export function disposeEveryToasterDevice(): void {
    const deviceIds = new Set([
        ...Object.keys(toasterStore.value ?? {}),
        ...activeNoteRepeatSessions.keys(),
        ...activeSessions.keys(),
        ...Array.from(padPending.values(), (pending) => pending.deviceId),
    ]);
    for (const deviceId of deviceIds) {
        disposeToasterDevice(deviceId);
    }
}
