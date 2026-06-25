import { type SampleEntry } from '../../models/SampleEntry';
import { sampleDatabaseStore } from '../../stores/sampleDatabaseStore';

/**
 * Identity-keyed memo. The similarity ranking is invariant while the underlying
 * `samples` array reference and the (targetId, limit) query are unchanged, so
 * the typed-array scoring pass and its allocations only run when one of those
 * changes. Repeated render-time reads for the same selection short-circuit.
 */
let memo: {
    samplesRef: readonly SampleEntry[];
    sampleId: string;
    limit: number;
    result: SampleEntry[];
} | null = null;

/**
 * Find samples similar to a given sample by tag overlap (Jaccard similarity).
 *
 * §69.1 — one-pass overlap without allocating a merge-Set per sample.
 * §156.1 — single-pass scoring into parallel index + score arrays
 * instead of a filter().map() that churns per-sample wrapper objects,
 * then a one-shot sort over only the candidates we intend to keep.
 */
export function findSimilarSamples(sampleId: string, limit: number = 10): SampleEntry[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }

    if (memo !== null && memo.samplesRef === state.samples && memo.sampleId === sampleId && memo.limit === limit) {
        return memo.result;
    }

    const target = state.samples.find((s) => s.id === sampleId);
    if (!target) {
        return [];
    }

    const targetTags = new Set(target.tags.map((t) => t.name));
    const targetSize = targetTags.size;
    const samples = state.samples;

    // Parallel arrays: indexes[i] is the position in `samples`, scores[i]
    // is the Jaccard similarity. Allocated once at pre-filter size (N-1
    // worst case); no per-sample wrapper objects.
    const indexes = new Int32Array(samples.length);
    const scores = new Float64Array(samples.length);
    let count = 0;

    for (let i = 0; i < samples.length; i++) {
        const s = samples[i]!;
        if (s.id === sampleId) {
            continue;
        }
        const sampleTags = s.tags;
        let overlap = 0;
        for (const tag of sampleTags) {
            if (targetTags.has(tag.name)) {
                overlap++;
            }
        }
        const union = targetSize + sampleTags.length - overlap || 1;
        indexes[count] = i;
        scores[count] = overlap / union;
        count++;
    }

    // Build an index permutation of [0, count) sorted by descending score.
    // One Int32Array allocation for the permutation, no wrapper objects.
    const permutation = new Int32Array(count);
    for (let i = 0; i < count; i++) {
        permutation[i] = i;
    }
    permutation.sort((a, b) => scores[b]! - scores[a]!);

    const take = Math.min(limit, count);
    const out: SampleEntry[] = Array.from({ length: take });
    for (let i = 0; i < take; i++) {
        out[i] = samples[indexes[permutation[i]!]!]!;
    }
    memo = { samplesRef: state.samples, sampleId, limit, result: out };
    return out;
}
