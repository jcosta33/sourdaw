import { pushUndoEntry } from '#/modules/Command/useCases';

import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { flushPendingMappingAmountDrag } from './flushPendingMappingAmountDrag';
import { mappingAmountDragKey, mappingAmountDragState } from './mappingAmountDragState';
import { type MappingTarget } from './removeMapping';
import { updateMapping } from './updateMapping';

function sameTarget(mapping: ModulatorMapping, target: MappingTarget): boolean {
    return (
        mapping.targetTrackId === target.targetTrackId &&
        mapping.targetDeviceId === target.targetDeviceId &&
        mapping.targetParamId === target.targetParamId
    );
}

/**
 * End the drag on one mapping and register a single undo entry for the whole
 * gesture — the modulation-amount counterpart of `endDrawSession`: cancel the
 * pending frame flush, flush the final amount, then push one entry restoring
 * the amount the gesture started from. A no-op for a mapping with no session.
 */
export function endMappingAmountDrag(modulatorId: string, target: MappingTarget): void {
    const key = mappingAmountDragKey(modulatorId, target);
    const session = mappingAmountDragState.activeSessions.get(key);
    if (!session) {
        return;
    }

    if (session.rafId !== null) {
        cancelAnimationFrame(session.rafId);
        session.rafId = null;
    }
    flushPendingMappingAmountDrag(session);
    mappingAmountDragState.activeSessions.delete(key);

    const mapping = modulationStore.value?.modulators
        .find((m) => m.id === modulatorId)
        ?.mappings.find((x) => sameTarget(x, target));
    // No committed change to undo: a click that never moved the thumb, or a
    // mapping that vanished mid-gesture (removed by a peer).
    if (!mapping || mapping.amount === session.previousAmount) {
        return;
    }
    const finalAmount = mapping.amount;

    pushUndoEntry(
        'Adjust modulation amount',
        () => {
            updateMapping(modulatorId, target, { amount: session.previousAmount });
        },
        () => {
            updateMapping(modulatorId, target, { amount: finalAmount });
        }
    );
}
