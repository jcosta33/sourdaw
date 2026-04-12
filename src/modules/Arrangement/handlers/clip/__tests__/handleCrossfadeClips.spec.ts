import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCrossfadeClips } from '../handleCrossfadeClips';

const mocks = vi.hoisted(() => ({
    crossfadeClips: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/crossfadeClips', () => ({
    crossfadeClips: mocks.crossfadeClips,
}));

describe('handleCrossfadeClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes crossfadeClips with the provided payload', () => {
        handleCrossfadeClips.execute({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });

        expect(mocks.crossfadeClips).toHaveBeenCalledWith('c1', 'c2', 0.5);
    });

    it('provides a description', () => {
        const desc = handleCrossfadeClips.describe({
            type: 'crossfadeClips',
            payload: { clipAId: 'c1', clipBId: 'c2', durationBeats: 0.5 },
        });
        expect(desc.label).toBe('Crossfade clips');
    });

    it('is undoable', () => {
        expect(handleCrossfadeClips.undoable).toBe(true);
    });
});
