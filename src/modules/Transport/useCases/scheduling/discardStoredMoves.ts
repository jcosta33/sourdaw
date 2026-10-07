import { type StoredControllerNode } from '../../models/StoredControllerNode';

/**
 * Drop the stored controller moves one device still has queued for a frame that
 * has not come: the look-ahead past a position playback has just left.
 *
 * `allNotesOff` keeps queued Grand Boule pedals and every queued Levain
 * controller (a controller is state, not a note), so after a jump, a wrap, a seek
 * or a stop a lift or a CC11 move posted for the old timeline would still apply,
 * over the destination's restore or after the stop. Only moves stored playback
 * posted are dropped: the engine tells them from a performer's by the `stored`
 * mark they were posted with. Queue-only, so a controller already applied keeps
 * its value.
 */
export function discardStoredMoves(deviceType: string, node: StoredControllerNode): void {
    if (deviceType === 'grand-boule') {
        node.grandBouleControls?.discardStoredPedals?.();
    } else if (deviceType === 'levain') {
        node.levainControls?.discardStoredCc?.();
    }
}
