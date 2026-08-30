import { type ModulatorMapping } from '../../models/Modulator';
import { modulationStore } from '../../stores/modulationStore';

import { endMappingAmountDrag } from './endMappingAmountDrag';
import { mappingAmountDragKey, mappingAmountDragState } from './mappingAmountDragState';
import { type MappingTarget } from './removeMapping';

function sameTarget(mapping: ModulatorMapping, target: MappingTarget): boolean {
    return (
        mapping.targetTrackId === target.targetTrackId &&
        mapping.targetDeviceId === target.targetDeviceId &&
        mapping.targetParamId === target.targetParamId
    );
}

/**
 * Begin a modulation-amount drag gesture on one mapping. The mapping's current
 * amount becomes the undo restore point for the whole gesture. Other mappings'
 * gestures are independent sessions and are not touched.
 */
export function beginMappingAmountDrag(modulatorId: string, target: MappingTarget): void {
    // A pointerup can be missed even at window level (the window loses focus
    // under the gesture). Close the stranded gesture for THIS mapping first so
    // it still gets its single undo entry instead of being silently discarded
    // by the replacement.
    endMappingAmountDrag(modulatorId, target);

    const state = modulationStore.value;
    const mapping = state?.modulators.find((m) => m.id === modulatorId)?.mappings.find((x) => sameTarget(x, target));
    if (!mapping) {
        return;
    }

    mappingAmountDragState.activeSessions.set(mappingAmountDragKey(modulatorId, target), {
        modulatorId,
        target,
        previousAmount: mapping.amount,
        pendingAmount: null,
        rafId: null,
    });
}
