import { type SampleEntry } from '../../models/SampleEntry';
import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

/**
 * Identity-keyed memo. The unique sorted tag list is invariant while the
 * underlying `samples` array reference is unchanged, so we recompute the
 * O(N×T) scan only when `state.samples` is replaced (every mutator produces a
 * fresh array). Repeated render-time reads then short-circuit.
 */
let memo: { samplesRef: readonly SampleEntry[]; result: string[] } | null = null;

export function getAllTags(): string[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }
    if (memo !== null && memo.samplesRef === state.samples) {
        return memo.result;
    }
    const tagSet = new Set<string>();
    for (const sample of state.samples) {
        for (const tag of sample.tags) {
            tagSet.add(tag.name);
        }
    }
    const result = [...tagSet].sort();
    memo = { samplesRef: state.samples, result };
    return result;
}
