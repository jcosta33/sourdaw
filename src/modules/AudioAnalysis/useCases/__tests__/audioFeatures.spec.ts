import { describe, it, expect, vi } from 'vitest';

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioBufferCache: { get: vi.fn(() => null) },
}));

vi.mock('meyda', () => ({
    default: { extract: vi.fn(() => null) },
}));

import { extractFeatures, summarizeFeatures } from '../audioFeatures';

describe('audioFeatures', () => {
    it('extractFeatures returns an empty array when the buffer is missing', () => {
        expect(extractFeatures('missing')).toEqual([]);
    });

    it('summarizeFeatures returns null when the buffer is missing', () => {
        expect(summarizeFeatures('missing')).toBeNull();
    });
});
