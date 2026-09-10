import { executeUserAppAction } from '#/modules/Command/useCases';

import { PROCESSOR_TYPES, type ProcessorType } from '../models/ProcessorCatalog';
import { yeastStore, type YeastProcessorInfo } from '../stores/yeastStore';

/**
 * Discrete rack gestures — bypass, remove, reorder, add — bound to their
 * guarded, undoable actions. Every guard reads the LIVE store at dispatch time
 * rather than the rendered prop, so a peer edit that landed since the last
 * render is still what the guard locks against (the strip reads `trackStore`
 * inside `commitGain` for the same reason). Conflicts surface as user
 * warnings, never throws.
 */

function findLiveProcessor(processorId: string): YeastProcessorInfo | undefined {
    return yeastStore.value?.processors.find((candidate) => candidate.id === processorId);
}

function catalogName(type: ProcessorType): string {
    return PROCESSOR_TYPES.find((entry) => entry.type === type)?.name ?? type;
}

export function dispatchSetYeastProcessorBypass(processorId: string): void {
    const processor = findLiveProcessor(processorId);
    if (!processor) {
        return;
    }
    void executeUserAppAction({
        type: 'setYeastProcessorBypass',
        payload: {
            processorId: processor.id,
            bypassed: !processor.bypassed,
            expectedBypassed: processor.bypassed,
        },
    });
}

export function dispatchRemoveYeastProcessor(processorId: string): void {
    const state = yeastStore.value;
    const processor = state?.processors.find((candidate) => candidate.id === processorId);
    if (!state || !processor) {
        return;
    }
    void executeUserAppAction({
        type: 'removeYeastProcessor',
        payload: {
            processorId: processor.id,
            expectedProcessor: processor,
            expectedIndex: state.processors.indexOf(processor),
        },
    });
}

export function dispatchReorderYeastProcessor(processorId: string, toIndex: number): void {
    const state = yeastStore.value;
    if (!state) {
        return;
    }
    void executeUserAppAction({
        type: 'reorderYeastProcessor',
        payload: {
            processorId,
            toIndex,
            expectedOrder: state.processors.map((candidate) => candidate.id),
        },
    });
}

export function dispatchAddYeastProcessor(type: ProcessorType): void {
    // The id is minted here, at the call site, so the action carries one
    // deterministic replay identity instead of the use case minting per run.
    void executeUserAppAction({
        type: 'addYeastProcessor',
        payload: {
            processorId: `${type}-${crypto.randomUUID()}`,
            type,
            name: catalogName(type),
        },
    });
}
