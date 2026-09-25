import { type BacteriaModAssignment } from './BacteriaPatch';

/**
 * Wire version of the Bacteria modulation-assignments chunk. **Never renamed,
 * never reused.** Bump this only when the payload shape changes in a way an
 * older reader would misread; a reader that does not recognise the version
 * treats the chunk as absent rather than guessing at the fields.
 *
 * Distinct from anything the patch itself carries: this describes the
 * envelope the document stores the table in, the same role
 * `TOASTER_KIT_STATE_VERSION` plays for the kit chunk.
 */
export const BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION = 1;

type BacteriaModAssignmentsStateValue =
    | string
    | number
    | boolean
    | null
    | BacteriaModAssignmentsStateValue[]
    | { [key: string]: BacteriaModAssignmentsStateValue };

type BacteriaModAssignmentsStateChunk = {
    version: number;
    data: { [key: string]: BacteriaModAssignmentsStateValue };
};

/**
 * Serialise the live modulation-routing table into the device-state chunk the
 * document stores.
 *
 * Each row is copied field by field rather than spread, so a future UI field
 * riding along on `BacteriaModAssignment` — none exists today — cannot leak
 * into the document unnoticed; the wire shape is named here, not inherited
 * from whatever the in-memory type happens to carry.
 */
export function toBacteriaModAssignmentsState(
    assignments: readonly BacteriaModAssignment[]
): BacteriaModAssignmentsStateChunk {
    return {
        version: BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION,
        data: {
            modAssignments: assignments.map((assignment) => ({
                sourceId: assignment.sourceId,
                targetParam: assignment.targetParam,
                amount: assignment.amount,
                bipolar: assignment.bipolar,
            })),
        },
    };
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValidRow(value: unknown): value is BacteriaModAssignment {
    return (
        isRecord(value) &&
        typeof value.sourceId === 'string' &&
        typeof value.targetParam === 'string' &&
        typeof value.amount === 'number' &&
        Number.isFinite(value.amount) &&
        typeof value.bipolar === 'boolean'
    );
}

/**
 * Rebuild the modulation-routing table from a stored device-state chunk.
 *
 * `null` covers an absent chunk, a wrong version, and a malformed
 * `data.modAssignments` — every case this build cannot trust — rather than
 * degrading to a default the way `fromToasterKitState` does: an empty table
 * and "nothing stored yet" mean the same thing to every caller here (the
 * persistence subscriber's equality skip, the load subscriber, the offline
 * hydration arm), so there is no partial-default shape worth inventing.
 *
 * A malformed *row* is dropped rather than failing the whole table: one
 * hand-edited or corrupted entry must not cost every other row its routing.
 */
export function fromBacteriaModAssignmentsState(chunk: unknown): BacteriaModAssignment[] | null {
    if (!isRecord(chunk) || chunk.version !== BACTERIA_MOD_ASSIGNMENTS_STATE_VERSION) {
        return null;
    }
    if (!isRecord(chunk.data) || !Array.isArray(chunk.data.modAssignments)) {
        return null;
    }

    return chunk.data.modAssignments.filter(isValidRow).map((row) => ({
        sourceId: row.sourceId,
        targetParam: row.targetParam,
        amount: row.amount,
        bipolar: row.bipolar,
    }));
}
