import { yeastStore, type YeastProcessorInfo, type YeastState } from '../stores/yeastStore';

/** Live rack state, or `null` when the store has not hydrated yet. */
export function readYeastRackState(): YeastState | null {
    return yeastStore.value;
}

/** The one live processor, or `undefined` when the rack has not hydrated or the
 *  id is not in it. */
export function findLiveProcessor(processorId: string): YeastProcessorInfo | undefined {
    const state = yeastStore.value;
    return state ? findProcessor(state, processorId) : undefined;
}

export function findProcessor(state: YeastState, processorId: string): YeastProcessorInfo | undefined {
    return state.processors.find((candidate) => candidate.id === processorId);
}

export function processorIndex(state: YeastState, processorId: string): number {
    return state.processors.findIndex((candidate) => candidate.id === processorId);
}

/** The rack's processor-id sequence — the only thing `reorderYeastProcessor`'s
 *  guard compares, so a peer editing a parameter never blocks a reorder undo. */
export function processorOrder(state: YeastState): string[] {
    return state.processors.map((processor) => processor.id);
}

/** Move one id from its current position to `toIndex`, returning a new array. */
export function moveProcessorId(order: readonly string[], processorId: string, toIndex: number): string[] {
    const fromIndex = order.indexOf(processorId);
    if (fromIndex < 0 || toIndex < 0 || toIndex >= order.length) {
        return [...order];
    }
    const next = [...order];
    next.splice(fromIndex, 1);
    next.splice(toIndex, 0, processorId);
    return next;
}

/**
 * Structural equality for the snapshot payloads these handlers guard and
 * restore. Both sides are consistently produced JSON-safe data (store reads and
 * describe-time captures, round-tripped through persisted entries verbatim), so
 * a canonical JSON compare sees a peer's param-level edit that a reference
 * compare would miss.
 */
export function isSameSnapshot(left: unknown, right: unknown): boolean {
    return JSON.stringify(left) === JSON.stringify(right);
}
