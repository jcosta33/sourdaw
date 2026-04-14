import { describe, it, expect, vi } from 'vitest';
import { getTempoAtBeat } from '../getTempoAtBeat';

const mocks = vi.hoisted(() => ({
    modelGetTempoAtBeat: vi.fn(),
}));

vi.mock('../../../models/TempoMap', () => ({
    getTempoAtBeat: mocks.modelGetTempoAtBeat,
}));

describe('getTempoAtBeat', () => {
    it('should delegate to the tempo map model', () => {
        const changes = [{ id: 'c1', beat: 0, tempo: 120, curve: 'instant' as const }];
        mocks.modelGetTempoAtBeat.mockReturnValue(118);

        expect(getTempoAtBeat(changes, 32, 120)).toBe(118);
        expect(mocks.modelGetTempoAtBeat).toHaveBeenCalledWith(changes, 32, 120);
    });
});
