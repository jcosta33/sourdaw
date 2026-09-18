import { PROCESSOR_TYPES, type ProcessorType } from '../models/ProcessorCatalog';
import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

/**
 * `processorId` is application-owned: the dispatching surface mints it before
 * the action carries it, so undo/redo replay is deterministic (#2111). The
 * fallback mints here for direct use-case callers that have no replay identity.
 * `name` overrides the catalog display name when provided; the guarded add
 * action always supplies it, so the write lands exactly the name the add's
 * remove-inverse guards (#2111).
 */
export function addYeastProcessor(
    type: ProcessorType,
    processorId = `${type}-${crypto.randomUUID()}`,
    name?: string
): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const id = processorId;
    const catalogEntry = PROCESSOR_TYPES.find((entry) => entry.type === type);
    const resolvedName = name ?? catalogEntry?.name ?? type;
    commitYeastProjection([...state.processors, { id, type, name: resolvedName, bypassed: false, params: {} }]);
}
