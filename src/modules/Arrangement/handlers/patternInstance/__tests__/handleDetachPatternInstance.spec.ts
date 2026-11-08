import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDetachPatternInstance } from '../handleDetachPatternInstance';

const mocks = vi.hoisted(() => ({
    detachPatternInstance: vi.fn<(clipId: string) => boolean>(),
    getLink: vi.fn(),
    isCurrent: vi.fn(),
}));
vi.mock('../../../useCases/patternInstance/getPatternInstanceLinkState', () => ({
    getPatternInstanceLinkState: mocks.getLink,
}));
vi.mock('../../../useCases/patternInstance/isPatternInstanceLinkCurrent', () => ({
    isPatternInstanceLinkCurrent: mocks.isCurrent,
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
        mocks.getLink.mockReturnValue({
            trackId: 'track',
            state: {
                parentClipId: { present: true, value: 'source' },
                overrides: { present: true, value: { notes: true, color: false } },
            },
        });
        mocks.isCurrent.mockReturnValue(true);
    });

    it('returns written synchronously only when a linked clip was detached', () => {
        mocks.detachPatternInstance.mockReturnValue(true);

        const result = handleDetachPatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'written' });
        expect(mocks.detachPatternInstance).toHaveBeenCalledWith('instance-clip');
        expect(handleDetachPatternInstance.undoable).toBe(true);
        const description = handleDetachPatternInstance.describe(action);
        expect(description).toEqual({
            label: 'Detach Pattern Instance',
            inverseAction: {
                type: 'restorePatternInstanceLink',
                payload: {
                    clipId: 'instance-clip',
                    trackId: 'track',
                    expected: { parentClipId: { present: false }, overrides: { present: false } },
                    replacement: {
                        parentClipId: { present: true, value: 'source' },
                        overrides: { present: true, value: { notes: true, color: false } },
                    },
                },
            },
            redoAction: {
                type: 'restorePatternInstanceLink',
                payload: {
                    clipId: 'instance-clip',
                    trackId: 'track',
                    replacement: { parentClipId: { present: false }, overrides: { present: false } },
                    expected: {
                        parentClipId: { present: true, value: 'source' },
                        overrides: { present: true, value: { notes: true, color: false } },
                    },
                },
            },
        });
        expect(handleDetachPatternInstance.batchExecution).toBe('singleton');
        expect(handleDetachPatternInstance.previewExecution).toBeUndefined();
    });

    it('returns no-write synchronously when detach is rejected', () => {
        mocks.detachPatternInstance.mockReturnValue(false);

        const result = handleDetachPatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.detachPatternInstance).toHaveBeenCalledOnce();
    });

    it('drops a previous capture when the same requested action now describes an independent clip', () => {
        handleDetachPatternInstance.describe(action);
        mocks.getLink.mockReturnValue({
            trackId: 'track',
            state: { parentClipId: { present: false }, overrides: { present: false } },
        });
        expect(handleDetachPatternInstance.describe(action)).toEqual({
            label: 'Detach Pattern Instance',
            inverseAction: null,
        });
        mocks.isCurrent.mockReturnValue(false);
        mocks.detachPatternInstance.mockReturnValue(false);
        expect(handleDetachPatternInstance.execute(action)).toEqual({ status: 'no-write' });
    });
});
