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
    });

    it('executes glueClips with the provided payload', () => {
        void handleGlueClips.execute({
            type: 'glueClips',
            payload: { clipIds: ['c1', 'c2'] },
        });

        expect(mocks.glueClips).toHaveBeenCalledWith(['c1', 'c2']);
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
