import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../stores/kneadStore', () => ({
    updateClipKneadState: vi.fn(),
}));

import { updateClipKneadState } from '../../stores/kneadStore';
import { ingestDspAnalysis } from '../dspAnalysis';

describe('ingestDspAnalysis', () => {
    beforeEach(() => {
        vi.mocked(updateClipKneadState).mockClear();
    });

    it('writes empty blobs when no frames are voiced', () => {
        ingestDspAnalysis('c1', [
            { time: 0, f0: null, periodicity: 0 },
            { time: 0.01, f0: null, periodicity: 0 },
        ]);

        expect(updateClipKneadState).toHaveBeenCalledWith('c1', expect.any(Function));
        const updater = vi.mocked(updateClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toEqual([]);
    });

    it('emits a blob with averaged pitch center for a voiced region', () => {
        // 6 frames at A4 (440Hz) — exceeds the 5-frame threshold
        const frames = Array.from({ length: 6 }, (_, i) => ({
            time: i * 0.01,
            f0: 440,
            periodicity: 0.9,
        }));
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toHaveLength(1);
        const blob = next.blobs[0]!;
        // 440Hz = MIDI 69 = 6900 cents
        expect(blob.pitchCenterCents).toBe(6900);
        expect(blob.startTime).toBe(0);
        expect(blob.endTime).toBeCloseTo(0.05);
    });

    it('discards voiced regions shorter than 6 frames', () => {
        const frames = [
            { time: 0, f0: 440, periodicity: 0.9 },
            { time: 0.01, f0: 440, periodicity: 0.9 },
            { time: 0.02, f0: null, periodicity: 0 },
        ];
        ingestDspAnalysis('c1', frames);

        const updater = vi.mocked(updateClipKneadState).mock.calls[0]![1];
        const next = updater({ blobs: [] } as never);
        expect(next.blobs).toEqual([]);
    });
});
