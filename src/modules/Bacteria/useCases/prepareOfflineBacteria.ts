import { fromBacteriaModAssignmentsState } from '../models/BacteriaModAssignmentsState';
import { mapBacteriaModAssignments } from '../models/BacteriaModulationIds';

/** Mirrors the live worklet's own refusal in `BacteriaNode.setModAssignments`. */
const MAX_MOD_ASSIGNMENTS = 64;

export type PrepareOfflineBacteriaInput = {
    /** The device's persisted `deviceState` chunk, or undefined when it has none. */
    deviceState: unknown;
    /** Worklet port of the offline Bacteria instance. */
    port: MessagePort;
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
 */
export function prepareOfflineBacteria({ deviceState, port }: PrepareOfflineBacteriaInput): void {
    const assignments = fromBacteriaModAssignmentsState(deviceState);
    if (!assignments || assignments.length === 0 || assignments.length > MAX_MOD_ASSIGNMENTS) {
        return;
    }

    const mapped = mapBacteriaModAssignments(assignments);
    if (!mapped) {
        return;
    }

    port.postMessage({ type: 'set-mod-assignments', assignments: mapped });
}
