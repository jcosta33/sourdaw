import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleGlueClips } from '../handleGlueClips';

const mocks = vi.hoisted(() => ({
    glueClips: vi.fn(),
}));

vi.mock('../../../useCases/clipEditing/glueClips', () => ({
    glueClips: mocks.glueClips,
}));

describe('handleGlueClips', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.glueClips.mockReturnValue(true);
    });

    it('executes glueClips with the provided payload', () => {
        const result = handleGlueClips.execute({
            type: 'glueClips',
            payload: { clipIds: ['c1', 'c2'] },
        });

        expect(mocks.glueClips).toHaveBeenCalledWith(['c1', 'c2']);
        expect(result).toEqual({ status: 'written' });
    });

    it('returns no-write when glue is rejected', () => {
        mocks.glueClips.mockReturnValue(false);

        const result = handleGlueClips.execute({
            type: 'glueClips',
            payload: { clipIds: ['c1', 'c2'] },
        });

        expect(result).toEqual({ status: 'no-write' });
    });

    it('provides a description', () => {
        const desc = handleGlueClips.describe({
            type: 'glueClips',
            payload: { clipIds: [] },
        });
        expect(desc.label).toBe('Glue clips');
    });

    it('is undoable', () => {
        expect(handleGlueClips.undoable).toBe(true);
    });
});
