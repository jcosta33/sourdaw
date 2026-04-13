import { sampleDatabaseStore } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';
import { type SampleEntry } from '#/modules/SoundLibrary/models/SampleEntry';

/**
 * Find samples similar to a given sample by tag overlap (Jaccard similarity).
 */
export function findSimilarSamples(sampleId: string, limit: number = 10): SampleEntry[] {
    const state = sampleDatabaseStore.value;
    if (!state) {
        return [];
    }

    const target = state.samples.find((s) => s.id === sampleId);
    if (!target) {
        return [];
    }

    const targetTags = new Set(target.tags.map((t) => t.name));
    const targetSize = targetTags.size;

    // §69.1 — compute Jaccard overlap without allocating a merge-Set per
    // sample. |A∪B| = |A| + |B| - |A∩B|, and overlap is computed by one
    // pass over the smaller tag set.
    return state.samples
        .filter((s) => s.id !== sampleId)
        .map((s) => {
            const sampleTags = s.tags;
            let overlap = 0;
            for (const tag of sampleTags) {
                if (targetTags.has(tag.name)) {
                    overlap++;
                }
            }
            const union = targetSize + sampleTags.length - overlap || 1;
            return { sample: s, similarity: overlap / union };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .map((r) => r.sample);
}
