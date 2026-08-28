import { pushUndoEntry } from '#/modules/Command/useCases';

import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { flushPendingMappingAmountDrag } from './flushPendingMappingAmountDrag';
import { mappingAmountDragState } from './mappingAmountDragState';
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
 * End the drag and register a single undo entry for the whole gesture — the
 * modulation-amount counterpart of `endDrawSession`: cancel the pending frame
 * flush, flush the final amount, then push one entry restoring the amount the
 * gesture started from.
 */
export function endMappingAmountDrag(): void {
    const activeSession = mappingAmountDragState.activeSession;
    if (activeSession === null) {
        return;
    }

    if (activeSession.rafId !== null) {
        cancelAnimationFrame(activeSession.rafId);
        activeSession.rafId = null;
    }
    flushPendingMappingAmountDrag();

    const { modulatorId, target, previousAmount } = activeSession;
    mappingAmountDragState.activeSession = null;

    const mapping = modulationStore.value?.modulators
        .find((m) => m.id === modulatorId)
        ?.mappings.find((x) => sameTarget(x, target));
    // No committed change to undo: a click that never moved the thumb, or a
    // mapping that vanished mid-gesture (removed by a peer).
    if (!mapping || mapping.amount === previousAmount) {
        return;
    }
    const finalAmount = mapping.amount;

    pushUndoEntry(
        'Adjust modulation amount',
        () => {
            updateMapping(modulatorId, target, { amount: previousAmount });
        },
        () => {
            updateMapping(modulatorId, target, { amount: finalAmount });
        }
    );
}
