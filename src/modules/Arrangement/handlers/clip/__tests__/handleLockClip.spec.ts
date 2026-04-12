import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleLockClip } from '../handleLockClip';

const mocks = vi.hoisted(() => ({
    lockClip: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/lockClip', () => ({
    lockClip: mocks.lockClip,
}));

describe('handleLockClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes lockClip with the provided payload', () => {
        handleLockClip.execute({
            type: 'lockClip',
            payload: { clipId: 'c1', locked: true },
        });

        expect(mocks.lockClip).toHaveBeenCalledWith('c1', true);
    });

    it('provides a description reflecting lock status', () => {
        const desc1 = handleLockClip.describe({
            type: 'lockClip',
            payload: { clipId: 'c1', locked: true },
        });
        expect(desc1.label).toBe('Lock clip');

        const desc2 = handleLockClip.describe({
            type: 'lockClip',
            payload: { clipId: 'c1', locked: false },
        });
        expect(desc2.label).toBe('Unlock clip');
    });

    it('is undoable', () => {
        expect(handleLockClip.undoable).toBe(true);
    });
});
