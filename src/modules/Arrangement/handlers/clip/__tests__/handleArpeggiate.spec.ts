import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleArpeggiate } from '../handleArpeggiate';

const mocks = vi.hoisted(() => ({
    arpeggiate: vi.fn(),
}));

vi.mock('#/modules/MIDI/useCases', () => ({
    arpeggiate: mocks.arpeggiate,
}));

describe('handleArpeggiate', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes arpeggiate with the provided payload', () => {
        handleArpeggiate.execute({
            type: 'arpeggiate',
            payload: {
                clipId: 'c1',
                pattern: 'down',
                rate: 8,
                octaves: 2,
                gate: 50,
            },
        });

        expect(mocks.arpeggiate).toHaveBeenCalledWith('c1', 'down', 8, 2, 50);
    });

    it('uses defaults for missing parameters', () => {
        handleArpeggiate.execute({
            type: 'arpeggiate',
            payload: {
                clipId: 'c1',
            },
        });

        expect(mocks.arpeggiate).toHaveBeenCalledWith('c1', 'up', 16, 1, 80);
    });

    it('provides a description based on pattern', () => {
        const desc1 = handleArpeggiate.describe({
            type: 'arpeggiate',
            payload: { clipId: 'c1', pattern: 'random' },
        });
        expect(desc1.label).toBe('Arpeggiate (random)');

        const desc2 = handleArpeggiate.describe({
            type: 'arpeggiate',
            payload: { clipId: 'c1' },
        });
        expect(desc2.label).toBe('Arpeggiate (up)');
    });

    it('is undoable', () => {
        expect(handleArpeggiate.undoable).toBe(true);
    });
});
