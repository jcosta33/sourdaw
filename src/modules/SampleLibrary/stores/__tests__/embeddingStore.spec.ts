import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { embeddingStore, setEmbedding } from '../embeddingStore';

describe('embeddingStore', () => {
    beforeEach(() => {
        embeddingStore.set({ embeddings: new Map(), modelStatus: 'idle' });
    });

    afterEach(() => embeddingStore.clear());

    it('starts with an empty embeddings map and an idle model', () => {
        expect(embeddingStore.value?.embeddings.size).toBe(0);
        expect(embeddingStore.value?.modelStatus).toBe('idle');
    });

    it('adds a new sample embedding without mutating the previous map', () => {
        const previousMap = embeddingStore.value!.embeddings;
        const vector = new Float32Array([0.1, 0.2, 0.3]);

        setEmbedding('sample-1', vector);

        expect(embeddingStore.value?.embeddings.get('sample-1')).toBe(vector);
        expect(embeddingStore.value?.embeddings.size).toBe(1);
        // The prior Map instance is untouched — setEmbedding must copy, not mutate.
        expect(previousMap.size).toBe(0);
    });

    it('overwrites an existing sample id with its new vector', () => {
        const first = new Float32Array([1, 0]);
        const second = new Float32Array([0, 1]);

        setEmbedding('sample-1', first);
        setEmbedding('sample-1', second);

        expect(embeddingStore.value?.embeddings.size).toBe(1);
        expect(embeddingStore.value?.embeddings.get('sample-1')).toBe(second);
    });

    it('preserves unrelated entries when adding another sample embedding', () => {
        const first = new Float32Array([1, 0]);
        const second = new Float32Array([0, 1]);

        setEmbedding('sample-1', first);
        setEmbedding('sample-2', second);

        expect(embeddingStore.value?.embeddings.get('sample-1')).toBe(first);
        expect(embeddingStore.value?.embeddings.get('sample-2')).toBe(second);
        expect(embeddingStore.value?.embeddings.size).toBe(2);
    });

    it('does nothing when the store has no state', () => {
        embeddingStore.clear();

        setEmbedding('sample-1', new Float32Array([1]));

        expect(embeddingStore.value).toBeNull();
    });
});
