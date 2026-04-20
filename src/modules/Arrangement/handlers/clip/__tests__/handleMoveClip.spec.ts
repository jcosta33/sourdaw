import { describe, it, expect, vi } from 'vitest';

import { moveClip } from '../../../useCases/clip/moveClip';
import { handleMoveClip } from '../handleMoveClip';

vi.mock('../../../useCases/clip/moveClip', () => ({
    moveClip: vi.fn(),
}));

describe('clipHandlers', () => {
    it('handleMoveClip forwards to moveClip use case', () => {
        void handleMoveClip.execute({
            type: 'moveClip',
            payload: { clipId: 'c1', trackId: 't1', startBeat: 4 },
        } as any);

        expect(moveClip).toHaveBeenCalledWith('c1', 't1', 4);
    });
});
