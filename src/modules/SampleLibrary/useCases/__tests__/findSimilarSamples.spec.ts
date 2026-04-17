import { describe, it, expect, vi, beforeEach } from 'vitest';
import { findSimilarSamples } from '#/modules/SampleLibrary/useCases/findSimilarSamples';
import { embeddingStore } from '#/modules/SampleLibrary/stores/embeddingStore';

describe('findSimilarSamples', () => {
    beforeEach(() => {
        embeddingStore.set({
            embeddings: new Map([
                ['s1', new Float32Array([1, 0])], // target
                ['s2', new Float32Array([0.9, 0.1])], // very similar
                ['s3', new Float32Array([0, 1])], // orthogonal
                ['s4', new Float32Array([-1, 0])], // opposite
            ]),
            modelStatus: 'ready',
        });
    });

    it('should return ranked results by cosine distance', () => {
        const result = findSimilarSamples('s1', 3);
        expect(result).toEqual(['s2', 's3', 's4']);
    });

    it('should return empty if target not found', () => {
        expect(findSimilarSamples('missing')).toEqual([]);
    });
});
