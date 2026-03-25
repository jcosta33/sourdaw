import { sampleDatabaseStore, type SampleEntry } from '#/modules/SoundLibrary/stores/sampleDatabaseStore';

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

    return state.samples
        .filter((s) => s.id !== sampleId)
        .map((s) => {
            const sampleTags = new Set(s.tags.map((t) => t.name));
            const overlap = [...targetTags].filter((t) => sampleTags.has(t)).length;
            const total = new Set([...targetTags, ...sampleTags]).size || 1;
            return { sample: s, similarity: overlap / total };
        })
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit)
        .map((r) => r.sample);
}
