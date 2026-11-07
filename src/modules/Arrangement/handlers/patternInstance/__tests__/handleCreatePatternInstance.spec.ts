import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleCreatePatternInstance } from '../handleCreatePatternInstance';
import { type AppAction } from '#/utils/handlerContract';

const mocks = vi.hoisted(() => ({
    createPatternInstance:
        vi.fn<
            (sourceClipId: string, targetTrackId: string, startBeat: number, targetClipId: string) => string | null
        >(),
    stamp: vi.fn(),
}));
vi.mock('../../clip/stampCreatedClipStateGuard', () => ({ stampCreatedClipStateGuard: mocks.stamp }));
vi.mock('../../clip/prepareCreatedClipRedoGuard', () => ({ prepareCreatedClipRedoGuard: () => undefined }));
vi.mock('#/modules/Command/useCases', () => ({ commitRedoInverseCapture: vi.fn() }));

vi.mock('../../../useCases/patternInstance/createPatternInstance', () => ({
    createPatternInstance: mocks.createPatternInstance,
}));

const action: Extract<AppAction, { type: 'createPatternInstance' }> = {
    type: 'createPatternInstance' as const,
    payload: { sourceClipId: 'source-clip', targetTrackId: 'midi-track', startBeat: 16, targetClipId: 'instance-clip' },
};

describe('handleCreatePatternInstance', () => {
    beforeEach(() => {
        mocks.createPatternInstance.mockReset();
        mocks.stamp.mockReset();
    });

    it('returns written synchronously only when an instance was created', () => {
        mocks.createPatternInstance.mockReturnValue('instance-clip');

        const result = handleCreatePatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'written' });
        expect(mocks.createPatternInstance).toHaveBeenCalledWith('source-clip', 'midi-track', 16, 'instance-clip');
        expect(handleCreatePatternInstance.undoable).toBe(true);
        expect(handleCreatePatternInstance.describe(action)).toMatchObject({
            label: 'Create Pattern Instance',
            inverseAction: { type: 'discardDuplicatedClip', payload: { clipId: 'instance-clip' } },
        });
        expect(mocks.stamp).toHaveBeenCalledOnce();
    });

    it('returns no-write synchronously when creation is rejected', () => {
        mocks.createPatternInstance.mockReturnValue(null);

        const result = handleCreatePatternInstance.execute(action);

        expect(result).not.toBeInstanceOf(Promise);
        expect(result).toEqual({ status: 'no-write' });
        expect(mocks.createPatternInstance).toHaveBeenCalledOnce();
        expect(mocks.stamp).not.toHaveBeenCalled();
    });

    it('materializes one canonical identity before description and preserves singleton preview admission', () => {
        const requested: Extract<AppAction, { type: 'createPatternInstance' }> = {
            type: 'createPatternInstance',
            payload: { sourceClipId: 'source-clip', targetTrackId: 'midi-track', startBeat: 16 },
        };
        handleCreatePatternInstance.materializeCommandArguments?.(requested);
        const targetClipId = requested.payload.targetClipId;
        expect(targetClipId).toMatch(/^clip-inst-/);
        handleCreatePatternInstance.materializeCommandArguments?.(requested);
        expect(requested.payload.targetClipId).toBe(targetClipId);
        expect(handleCreatePatternInstance.describe(requested)).toMatchObject({
            inverseAction: { payload: { clipId: targetClipId } },
        });
        expect(handleCreatePatternInstance.batchExecution).toBe('singleton');
        expect(handleCreatePatternInstance.previewExecution).toBeUndefined();
    });
});
