import { createStore } from '#/infra/store/createStore';

/**
 * Store for managing high-dimensional timbral embeddings.
 * R-G2: Timbral embedding and semantic search.
 */

export type EmbeddingState = {
    /** Map of sampleId -> vector (Float32Array, typically 128-512 dims) */
    embeddings: Map<string, Float32Array>;
    /** Status of the embedding model (CLAP/OpenL3) */
    modelStatus: 'idle' | 'loading' | 'ready' | 'error';
};

export const embeddingStore = createStore<EmbeddingState>({
    initialData: {
        embeddings: new Map(),
        modelStatus: 'idle',
    },
});

export function setEmbedding(sampleId: string, vector: Float32Array): void {
    const state = embeddingStore.value;
    if (state) {
        const next = new Map(state.embeddings);
        next.set(sampleId, vector);
        embeddingStore.set({ ...state, embeddings: next });
    }
}
