import {
    type ClipSatelliteSnapshot,
    type ClipSatelliteStateRestorePlan,
    readClipSatelliteEntry,
    writeClipSatelliteEntry,
} from '../../stores/clipSatelliteState';

import { clipSatelliteStateCodec } from './clipSatelliteStateCodec';
import { timeOperationStateCodec } from './timeOperationStateCodec';

/**
 * Transactional owner for the per-clip satellite stores a global time operation
 * retires alongside the clips themselves: clip gain envelopes and warp states.
 *
 * The plan is scoped to the affected clip ids rather than to whole stores. A
 * whole-store guard would make undo conflict with any unrelated warp or
 * envelope edit made after the operation; a per-clip guard only rejects when
 * the very entries being restored moved underneath us.
 *
 * Clip-scoped automation lanes are deliberately absent. They live in
 * Automation's store, which already joins the same transaction through
 * `prepareAutomationTimeOperation`; a second handle writing that store would
 * find a stale captured reference and refuse to publish.
 */
type TransactionPhase = 'prepared' | 'publishing' | 'applied' | 'closed';

const PLAN_KEYS = ['version', 'expected', 'replacement'] as const;
const SNAPSHOT_KEYS = ['version', 'entries'] as const;

function validateSnapshot(value: unknown): ClipSatelliteSnapshot | null {
    const properties = clipSatelliteStateCodec.readDataObject(value, SNAPSHOT_KEYS);
    if (!properties || properties.version !== 1) {
        return null;
    }
    const entries = clipSatelliteStateCodec.decodeEntries(properties.entries);
    return entries === null ? null : { version: 1, entries };
}

function validatePlan(value: unknown): ClipSatelliteStateRestorePlan | null {
    const properties = clipSatelliteStateCodec.readDataObject(value, PLAN_KEYS);
    if (!properties || properties.version !== 1) {
        return null;
    }

    const expected = validateSnapshot(properties.expected);
    const replacement = validateSnapshot(properties.replacement);
    if (!expected || !replacement || expected.entries.length !== replacement.entries.length) {
        return null;
    }
    // Both sides must address the same clip ids in the same order, so `apply`
    // and `revert` write exactly the entries the guard checked.
    for (const [index, entry] of expected.entries.entries()) {
        if (replacement.entries[index]?.clipId !== entry.clipId) {
            return null;
        }
    }
    return { version: 1, expected, replacement };
}

function snapshotMatchesStores(snapshot: ClipSatelliteSnapshot): boolean {
    for (const entry of snapshot.entries) {
        const current = readClipSatelliteEntry(entry.clipId);
        if (!timeOperationStateCodec.valuesEqual(current.gainEnvelope, entry.gainEnvelope)) {
            return false;
        }
        if (!timeOperationStateCodec.valuesEqual(current.warpState, entry.warpState)) {
            return false;
        }
    }
    return true;
}

function rejectedPreparation() {
    return {
        status: 'rejected' as const,
        hasChanges: false,
        apply: () => false,
        revert: () => false,
    };
}

/**
 * Prepare a satellite transition. Used in both directions: forward by
 * `executeGlobalTimeOperation` (live satellites to cleared) and backward by
 * `prepareTimeOperationStateRestore` for undo and redo.
 */
export function prepareClipSatelliteStateRestore(value: unknown): {
    status: 'ready' | 'rejected';
    hasChanges: boolean;
    apply: () => boolean;
    revert: () => boolean;
} {
    const validatedPlan = validatePlan(value);
    if (!validatedPlan) {
        return rejectedPreparation();
    }
    const expectedSnapshot = validatedPlan.expected;
    const replacementSnapshot = validatedPlan.replacement;
    if (!snapshotMatchesStores(expectedSnapshot)) {
        return rejectedPreparation();
    }

    const hasChanges = !timeOperationStateCodec.valuesEqual(expectedSnapshot.entries, replacementSnapshot.entries);
    let phase: TransactionPhase = 'closed';
    if (hasChanges) {
        phase = 'prepared';
    }

    function publish(from: ClipSatelliteSnapshot, to: ClipSatelliteSnapshot, nextPhase: 'applied' | 'closed'): boolean {
        if (!snapshotMatchesStores(from)) {
            phase = 'closed';
            return false;
        }

        phase = 'publishing';
        try {
            for (const entry of to.entries) {
                writeClipSatelliteEntry(entry);
            }
        } catch (error) {
            phase = 'closed';
            throw error;
        }
        if (!snapshotMatchesStores(to)) {
            phase = 'closed';
            return false;
        }
        phase = nextPhase;
        return true;
    }

    function apply(): boolean {
        if (phase !== 'prepared') {
            phase = 'closed';
            return false;
        }
        return publish(expectedSnapshot, replacementSnapshot, 'applied');
    }

    function revert(): boolean {
        if (phase !== 'applied') {
            phase = 'closed';
            return false;
        }
        return publish(replacementSnapshot, expectedSnapshot, 'closed');
    }

    return {
        status: 'ready',
        hasChanges,
        apply,
        revert,
    };
}
