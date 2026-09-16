import { describe, it, expect, beforeEach } from 'vitest';

import { embeddingStore } from '#/modules/SampleLibrary/stores/embeddingStore';
import { findSimilarSamples } from '#/modules/SampleLibrary/useCases/findSimilarSamples';

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

    it('should return ranked matches by cosine distance', () => {
        expect(findSimilarSamples('s1', 3)).toEqual({ status: 'matches', sampleIds: ['s2', 's3', 's4'] });
    });

    it('should report the target as unavailable when no embedding exists for it', () => {
        expect(findSimilarSamples('missing')).toEqual({ status: 'unavailable' });
    });

    it('should report zero matches when only the target sample has an embedding', () => {
        embeddingStore.set({
            embeddings: new Map([['s1', new Float32Array([1, 0])]]),
            modelStatus: 'ready',
        });
        expect(findSimilarSamples('s1')).toEqual({ status: 'matches', sampleIds: [] });
    });
});
