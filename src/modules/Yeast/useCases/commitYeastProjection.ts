import { batchStoreUpdates } from '#/infra/store/createStore';

import { setYeastRuntimeProjection } from '../engine/yeastRuntime';
import { createDurableYeastProcessorParams } from '../models/YeastProcessorProjection';
import { yeastStore, type YeastProcessorInfo } from '../stores/yeastStore';

import { createYeastRuntimeProjection } from './createYeastRuntimeProjection';
import { reconcileYeastGrooveAssignments } from './reconcileYeastGrooveAssignments';

/**
 * The single write path for the Yeast processor list — add, remove, reorder,
 * param and bypass all land here.
 *
 * Groove assignments are reconciled against the committed list right here, at
 * the mutation site, rather than from the CRDT projection (audit CC-2: a
 * projection is a pure reader). `removeYeastProcessor` also drops the removed
 * processor's assignments directly; this covers every *other* path that can
 * shrink the list, which previously relied on an unrelated document change
 * eventually triggering a full re-projection.
 */
export function commitYeastProjection(processors: readonly YeastProcessorInfo[]): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const nextProcessors = processors.map((processor) => ({
        ...processor,
        params: createDurableYeastProcessorParams(processor.type, processor.params),
    }));
    batchStoreUpdates(() => {
        yeastStore.set({
            ...state,
            processors: nextProcessors,
        });
        reconcileYeastGrooveAssignments();
    });
    setYeastRuntimeProjection(createYeastRuntimeProjection(nextProcessors));
}
