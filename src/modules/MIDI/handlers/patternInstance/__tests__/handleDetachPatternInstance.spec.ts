import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDetachPatternInstance } from '../handleDetachPatternInstance';

const mocks = vi.hoisted(() => ({
    detachPatternInstance: vi.fn<(clipId: string) => boolean>(),
}));

vi.mock('../../../useCases/patternInstance/detachPatternInstance', () => ({
    detachPatternInstance: mocks.detachPatternInstance,
}));

const action = {
    type: 'detachPatternInstance' as const,
    payload: { clipId: 'instance-clip' },
};

describe('handleDetachPatternInstance', () => {
    beforeEach(() => {
        mocks.detachPatternInstance.mockReset();
    });

    it('returns written synchronously only when a linked clip was detached', () => {
        mocks.detachPatternInstance.mockReturnValue(true);

        const result = handleDetachPatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'written' });
        expect(mocks.detachPatternInstance).toHaveBeenCalledWith('instance-clip');
        expect(handleDetachPatternInstance.undoable).toBe(true);
        expect(handleDetachPatternInstance.describe(action)).toEqual({ label: 'Detach Pattern Instance' });
    });

    it('returns no-write synchronously when detach is rejected', () => {
        mocks.detachPatternInstance.mockReturnValue(false);

        const result = handleDetachPatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.detachPatternInstance).toHaveBeenCalledOnce();
    });
});
