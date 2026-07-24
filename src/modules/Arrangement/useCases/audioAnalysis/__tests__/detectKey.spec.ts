import { describe, it, expect, vi, beforeEach } from 'vitest';

import * as subject from '../detectKey';

// Same profiles the Krumhansl-Schmuckler implementation uses, so the expected
// winning key is derived from the algorithm's own music-theory model.
const MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

function rotate(arr: number[], offset: number): number[] {
    const n = arr.length;
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
        out.push(arr[(i + offset) % n] ?? 0);
    }
    return out;
}

type Summary = { chromaProfile: number[] };

const mocks = vi.hoisted(() => ({
    getBufferForClip: vi.fn<(clipId: string) => { buffer: unknown; audioBufferId: string } | null>(),
    summarizeFeatures: vi.fn<(id: string) => Summary | null>(),
}));

vi.mock('../helpers', () => ({
    getBufferForClip: (clipId: string) => mocks.getBufferForClip(clipId),
}));

vi.mock('#/modules/AudioAnalysis/useCases', () => ({
    summarizeFeatures: (id: string) => mocks.summarizeFeatures(id),
}));

describe('detectKey', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.getBufferForClip.mockReturnValue({ buffer: {}, audioBufferId: 'b1' });
    });

    it('returns null when no audio buffer is cached for the clip', async () => {
        mocks.getBufferForClip.mockReturnValue(null);

        expect(await subject.detectKey('missing')).toBeNull();
    });

    it('falls back to C Major when feature extraction returns no summary', async () => {
        mocks.summarizeFeatures.mockReturnValue(null);

        expect(await subject.detectKey('c1')).toBe('C Major');
    });

    it('falls back to C Major when the chroma profile is malformed', async () => {
        mocks.summarizeFeatures.mockReturnValue({ chromaProfile: [1, 2, 3] });

        expect(await subject.detectKey('c1')).toBe('C Major');
    });

    it('classifies a chroma matching the C-major profile as C Major', async () => {
        mocks.summarizeFeatures.mockReturnValue({ chromaProfile: [...MAJOR_PROFILE] });

        expect(await subject.detectKey('c1')).toBe('C Major');
    });

    it('classifies a chroma matching the C-minor profile as C Minor', async () => {
        mocks.summarizeFeatures.mockReturnValue({ chromaProfile: [...MINOR_PROFILE] });

        expect(await subject.detectKey('c1')).toBe('C Minor');
    });

    it('identifies a non-C root when the chroma is a rotation of the major profile', async () => {
        // rotate(MAJOR, 5) best correlates with the G major (root=7) profile.
        mocks.summarizeFeatures.mockReturnValue({ chromaProfile: rotate(MAJOR_PROFILE, 5) });

        expect(await subject.detectKey('c1')).toBe('G Major');
    });
});
