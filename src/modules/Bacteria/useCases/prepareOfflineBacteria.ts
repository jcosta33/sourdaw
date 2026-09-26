import { fromBacteriaModAssignmentsState } from '../models/BacteriaModAssignmentsState';
import { resolveMappedBacteriaModAssignments } from '../models/BacteriaModulationIds';

import { type captureOfflineBacteria } from './captureOfflineBacteria';

export type PrepareOfflineBacteriaInput = {
    /** The device's persisted `deviceState` chunk, or undefined when it has none. */
    deviceState: unknown;
    /** Worklet port of the offline Bacteria instance. */
    port: MessagePort;
    /** Detached capture from `captureOfflineDeviceSetup`; wins over `deviceState` when present. */
    captured?: ReturnType<typeof captureOfflineBacteria>;
};

/**
 * Give an offline Bacteria render the modulation-routing table the project holds.
 *
 * `parameterValues` cannot carry this: the table is a variable-length list of rows,
 * not a fixed set of numeric leaves, so it rides `deviceState` instead — the same
 * chunk `commitBacteriaModAssignments` writes and `hydrateBacteriaModAssignmentsFromProject`
 * reads back for the live path. Without this arm the offline export replayed nothing,
 * so a bounced file lost every LFO, envelope, or macro routing the project had.
 *
 * Posts nothing — rather than an empty or partial table — when the chunk is absent
 * or unreadable, when it decodes to zero rows, when any row cannot be mapped to the
 * engine's numeric grammar (`mapBacteriaModAssignments` returns `null` for the whole
 * table on one unmappable row, since the target replaces its table wholesale), or when
 * the table exceeds the live node's own 64-row limit: an offline render must not apply
 * a routing the corresponding live node itself would have refused.
 *
 * `captured`, when present, replaces the `deviceState` decode outright — the same
 * capture-wins-over-snapshot contract every other offline hydration entry follows —
 * so a caller that already ran `captureOfflineDeviceSetup` need not (and, per its
 * explicit-project-source contract, must not) hand this a `deviceState` too.
 */
export function prepareOfflineBacteria({ deviceState, port, captured }: PrepareOfflineBacteriaInput): void {
    const assignments = captured ? captured.assignments : fromBacteriaModAssignmentsState(deviceState);
    const mapped = resolveMappedBacteriaModAssignments(assignments);
    if (!mapped) {
        return;
    }

    port.postMessage({ type: 'set-mod-assignments', assignments: mapped });
}
