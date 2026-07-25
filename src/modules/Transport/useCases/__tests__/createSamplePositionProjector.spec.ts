import { describe, it, expect, vi } from 'vitest';

import { createSamplePositionProjector } from '../createSamplePositionProjector';

vi.mock('../../stores/tempoMapStore', () => ({
    tempoMapStore: {
        value: {
            changes: [
                { id: 'tempo-0', beat: 0, tempo: 60, curve: 'instant' },
                { id: 'tempo-1', beat: 4, tempo: 120, curve: 'instant' },
            ],
        },
    },
}));

vi.mock('../../stores/transportStore', () => ({
    transportStore: { value: { tempo: 60 } },
}));

describe('createSamplePositionProjector', () => {
    it('captures the tempo map and inverts integrated samples across a change', () => {
        const resolvePpqPosition = createSamplePositionProjector();

        expect(resolvePpqPosition({ samples: 180_000, sampleRate: 48_000 })).toBeCloseTo(3.75, 10);
        expect(resolvePpqPosition({ samples: 204_000, sampleRate: 48_000 })).toBeCloseTo(4.5, 10);
    });

    it('falls back to 120 bpm and an empty tempo map when stores are absent', async () => {
        // vi.resetModules is required because the projector snapshots the store
        // values once at construction time. The fresh module load picks up the
        // null-store mocks defined below.
        vi.resetModules();
        vi.doMock('../../stores/transportStore', () => ({ transportStore: { value: null } }));
        vi.doMock('../../stores/tempoMapStore', () => ({ tempoMapStore: { value: null } }));
        // Re-import after the doMock so the module sees the null stores.
        const { createSamplePositionProjector: freshProjector } = await import('../createSamplePositionProjector');

        const resolvePpqPosition = freshProjector();
        // 120 bpm @ 48k -> 1 beat = 24000 samples. 48000 samples = 2 beats.
        expect(resolvePpqPosition({ samples: 48_000, sampleRate: 48_000 })).toBeCloseTo(2, 10);
    });
});
