import { describe, expect, it, vi } from 'vitest';

import { restoreLoopRegion } from '../../../useCases/transportControls/restoreLoopRegion';
import { handleRestoreLoopRegion } from '../handleRestoreLoopRegion';

vi.mock('../../../useCases/transportControls/restoreLoopRegion', () => ({
    restoreLoopRegion: vi.fn(),
}));

describe('handleRestoreLoopRegion', () => {
    it('delegates the complete loop snapshot to the atomic restore use case', () => {
        const region = { loopStart: 4, loopEnd: 12, isLooping: false };

        void handleRestoreLoopRegion.execute({ type: 'restoreLoopRegion', payload: region });

        expect(restoreLoopRegion).toHaveBeenCalledWith(region);
    });

    it('is internal compensation rather than a user-visible undo entry', () => {
        expect(handleRestoreLoopRegion.undoable).toBe(false);
    });
});
