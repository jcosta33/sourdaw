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
});
