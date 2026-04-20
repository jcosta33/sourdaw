import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCreatePatternInstance } from '../handleCreatePatternInstance';

const mocks = vi.hoisted(() => ({
    createPatternInstance: vi.fn(),
}));

vi.mock('../../../useCases/patternInstance/createPatternInstance', () => ({
    createPatternInstance: mocks.createPatternInstance,
}));

describe('handleCreatePatternInstance', () => {
    beforeEach(() => vi.clearAllMocks());

    it('delegates to createPatternInstance use case', async () => {
        await handleCreatePatternInstance.execute({
            type: 'createPatternInstance',
            payload: { sourceClipId: 'c1', targetTrackId: 't1', startBeat: 16 },
        });
        expect(mocks.createPatternInstance).toHaveBeenCalledWith('c1', 't1', 16);
    });
});
