import type { ProcessorType } from './ProcessorCatalog';

export type YeastProcessorProjectionItem = {
    id: string;
    type: ProcessorType;
    bypassed: boolean;
    params: Record<string, number>;
};

export type YeastProcessorProjection = YeastProcessorProjectionItem[];

/**
 * Whether two projections name the same rack topology: the same processor ids,
 * types and bypass states in the same order. Parameters are not topology.
 *
 * `MidiRack.topologyMatches` applies the same rule to the processors the worker
 * runs and settles the rack (note-offs, processor resets) when it fails, so a
 * caller deciding whether delivering a projection would settle the worker uses
 * this. `MidiRack.spec.ts` pins the two to agree.
 */
export function sameYeastProcessorTopology(
    left: readonly YeastProcessorProjectionItem[],
    right: readonly YeastProcessorProjectionItem[]
): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((processor, index) => {
        const other = right[index]!;
        return processor.id === other.id && processor.type === other.type && processor.bypassed === other.bypassed;
    });
}

export type YeastRuntimeStatus = 'uninitialized' | 'initializing' | 'ready' | 'unavailable';

export function createDurableYeastProcessorParams(
    type: ProcessorType,
    params: Record<string, number> | undefined
): Record<string, number> {
    const durableParams = { ...(params ?? {}) };
    if (type === 'chordMemory') {
        delete durableParams.learn;
        delete durableParams.clear;
    }
    return durableParams;
}

type YeastProcessorProjectionSource = {
    id: string;
    type: ProcessorType;
    bypassed: boolean;
    params?: Record<string, number>;
};

export function createYeastProcessorProjection(
    processors: readonly YeastProcessorProjectionSource[]
): YeastProcessorProjection {
    return processors.map((processor) => ({
        id: processor.id,
        type: processor.type,
        bypassed: processor.bypassed,
        params: createDurableYeastProcessorParams(processor.type, processor.params),
    }));
}
