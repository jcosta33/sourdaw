import { PROCESSOR_TYPES, type ProcessorType } from '../models/ProcessorCatalog';
import { yeastStore } from '../stores/yeastStore';

import { commitYeastProjection } from './commitYeastProjection';

export function addYeastProcessor(type: ProcessorType): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const id = `${type}-${crypto.randomUUID()}`;
    const catalogEntry = PROCESSOR_TYPES.find((entry) => entry.type === type);
    const name = catalogEntry?.name ?? type;
    commitYeastProjection([...state.processors, { id, type, name, bypassed: false, params: {} }]);
}
