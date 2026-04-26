import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCopyClip } from '../handleCopyClip';

const mocks = vi.hoisted(() => ({
    copySelectedClip: vi.fn(),
}));

vi.mock('../../../useCases/clipboard/copySelectedClip', () => ({
    copySelectedClip: mocks.copySelectedClip,
}));

describe('handleCopyClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes copySelectedClip', () => {
        void handleCopyClip.execute({ type: 'copyClip', payload: {} });
        expect(mocks.copySelectedClip).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handleCopyClip.describe({ type: 'copyClip', payload: {} });
        expect(desc.label).toBe('Copy clip');
    });

    it('is not undoable', () => {
        expect(handleCopyClip.undoable).toBe(false);
    });
});
