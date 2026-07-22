import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCreatePatternInstance } from '../handleCreatePatternInstance';

const mocks = vi.hoisted(() => ({
    createPatternInstance: vi.fn<(sourceClipId: string, targetTrackId: string, startBeat: number) => string | null>(),
}));

vi.mock('../../../useCases/patternInstance/createPatternInstance', () => ({
    createPatternInstance: mocks.createPatternInstance,
}));

const action = {
    type: 'createPatternInstance' as const,
    payload: { sourceClipId: 'source-clip', targetTrackId: 'midi-track', startBeat: 16 },
};

describe('handleCreatePatternInstance', () => {
    beforeEach(() => {
        mocks.createPatternInstance.mockReset();
    });

    it('returns written synchronously only when an instance was created', () => {
        mocks.createPatternInstance.mockReturnValue('instance-clip');

        const result = handleCreatePatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'written' });
        expect(mocks.createPatternInstance).toHaveBeenCalledWith('source-clip', 'midi-track', 16);
        expect(handleCreatePatternInstance.undoable).toBe(true);
        expect(handleCreatePatternInstance.describe(action)).toEqual({ label: 'Create Pattern Instance' });
    });

    it('returns no-write synchronously when creation is rejected', () => {
        mocks.createPatternInstance.mockReturnValue(null);

        const result = handleCreatePatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.createPatternInstance).toHaveBeenCalledOnce();
    });
});
