import { fromBacteriaModAssignmentsState } from '../models/BacteriaModAssignmentsState';

import type { BacteriaModAssignment } from '../models/BacteriaPatch';

export type CaptureOfflineBacteriaInput = {
    /** The device's persisted `deviceState` chunk, or undefined when it has none. */
    deviceState: unknown;
};

/**
 * Detach the modulation-routing table from project truth before graph
 * construction can yield.
 *
 * Reads only the device's persisted `deviceState` chunk — the same source
 * `hydrateBacteriaModAssignmentsFromProject` reads for the live path — and has
 * no session-store fallback: an offline export always hands this a `Device`
 * from the project snapshot, never a live session-store entry, so there is
 * nothing else for a `projectOnly` capture source to prefer. The `source`
 * parameter `captureOfflineDeviceSetup` threads through the Toaster and Grand
 * Boule captures to suppress their live-store fallback therefore changes
 * nothing here: the chunk is the only thing this function has ever read, so
 * `projectOnly` is honoured by construction rather than by a branch.
 *
 * `null` covers an absent, wrong-version, or malformed chunk, matching
 * `fromBacteriaModAssignmentsState`'s own contract: an empty table and
 * "nothing stored" mean the same thing to `prepareOfflineBacteria`'s refusal.
 */
export function captureOfflineBacteria({ deviceState }: CaptureOfflineBacteriaInput): {
    assignments: BacteriaModAssignment[] | null;
} {
    return structuredClone({ assignments: fromBacteriaModAssignmentsState(deviceState) });
}
