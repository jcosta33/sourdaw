import { PROCESSOR_TYPES, type ProcessorType } from '../models/ProcessorCatalog';
import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

/**
 * `processorId` is application-owned: the dispatching surface mints it before
 * the action carries it, so undo/redo replay is deterministic (#2111). The
 * fallback mints here for direct use-case callers that have no replay identity.
 */
export function addYeastProcessor(type: ProcessorType, processorId = `${type}-${crypto.randomUUID()}`): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const id = processorId;
    const catalogEntry = PROCESSOR_TYPES.find((entry) => entry.type === type);
    const name = catalogEntry?.name ?? type;
    commitYeastProjection([...state.processors, { id, type, name, bypassed: false, params: {} }]);
}
