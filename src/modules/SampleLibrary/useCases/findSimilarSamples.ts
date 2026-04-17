import { embeddingStore } from '../stores/embeddingStore';

/**
 * Find samples similar to a target sample based on embedding distance.
 * R-G2: Semantic similarity search.
 */
export function findSimilarSamples(sampleId: string, limit = 10): string[] {
    const state = embeddingStore.value;
    if (!state) return [];

    const target = state.embeddings.get(sampleId);
    if (!target) return [];

    const scores: { id: string; distance: number }[] = [];

    for (const [id, vector] of state.embeddings.entries()) {
        if (id === sampleId) continue;
        const dist = cosineDistance(target, vector);
        scores.push({ id, distance: dist });
    }

    return scores
        .sort((a, b) => a.distance - b.distance)
        .slice(0, limit)
        .map((s) => s.id);
}

function cosineDistance(a: Float32Array, b: Float32Array): number {
    if (a.length !== b.length) return 1;
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i]! * b[i]!;
        normA += a[i]! * a[i]!;
        normB += b[i]! * b[i]!;
    }
    if (normA === 0 || normB === 0) return 1;
    return 1 - dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
