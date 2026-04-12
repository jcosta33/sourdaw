import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handleCutClip } from '../handleCutClip';

const mocks = vi.hoisted(() => ({
    cutSelectedClip: vi.fn(),
}));

vi.mock('../../../useCases/clipboard/cutSelectedClip', () => ({
    cutSelectedClip: mocks.cutSelectedClip,
}));

describe('handleCutClip', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('executes cutSelectedClip', () => {
        handleCutClip.execute({ type: 'cutClip', payload: {} });
        expect(mocks.cutSelectedClip).toHaveBeenCalledTimes(1);
    });

    it('provides a description', () => {
        const desc = handleCutClip.describe({ type: 'cutClip', payload: {} });
        expect(desc.label).toBe('Cut clip');
    });

    it('is undoable', () => {
        expect(handleCutClip.undoable).toBe(true);
    });
});
