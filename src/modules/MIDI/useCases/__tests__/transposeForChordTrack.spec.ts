import { describe, it, expect, vi, beforeEach } from 'vitest';

import { transposeForChordTrack } from '../transposeForChordTrack';

const mocks = vi.hoisted(() => ({
    transposeForChordTrack: vi.fn(),
}));

vi.mock('../../transformers/chordTransposer', () => ({
    transposeForChordTrack: mocks.transposeForChordTrack,
}));

describe('transposeForChordTrack', () => {
    beforeEach(() => {
        vi.mocked(mocks.transposeForChordTrack).mockReset();
    });

    it('should delegate to the chord transposer transformer', () => {
        mocks.transposeForChordTrack.mockReturnValue(67);

        const ref = { id: 'r', beat: 0, root: 0, quality: 'major' as const, duration: 4 };
        const tgt = { id: 't', beat: 0, root: 2, quality: 'major' as const, duration: 4 };

        expect(transposeForChordTrack(60, ref, tgt)).toBe(67);
        expect(mocks.transposeForChordTrack).toHaveBeenCalledWith(60, ref, tgt);
    });
});
