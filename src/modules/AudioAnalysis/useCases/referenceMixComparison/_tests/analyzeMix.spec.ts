import { describe, it, expect, vi } from 'vitest';

vi.mock('#/modules/Arrangement', () => ({
    trackStore: {
        value: {
            tracks: [
                { id: 't1', kind: 'audio', gain: 1 },
                { id: 't2', kind: 'midi', gain: 1 },
            ],
        },
    },
}));

import { analyzeMix } from '../analyzeMix/analyzeMix';
import { createReferenceAnalysis } from '../analyzeMix/createReferenceAnalysis';

describe('analyzeMix (track layout)', () => {
    it('analyzeMix returns a profile shaped like the MixAnalysis type', () => {
        const result = analyzeMix();
        expect(result.frequencyProfile).toBeDefined();
        expect(typeof result.lufs).toBe('number');
    });

    it('createReferenceAnalysis returns a baseline analysis', () => {
        const ref = createReferenceAnalysis();
        expect(ref).toBeDefined();
        expect(ref.frequencyProfile).toBeDefined();
    });
});
