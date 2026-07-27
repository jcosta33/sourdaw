import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDiscardCreatedTrack } from '../discardCreatedTrack';

const mocks = vi.hoisted(() => ({
    finalizeRuntimeRemoval: vi.fn(),
    finalizeModulationRemoval: vi.fn(),
    publishTrackRemoved: vi.fn(),
    removeTrack: vi.fn(),
    removeTrackModulationReferences: vi.fn(),
}));

vi.mock('../../../useCases/publishTrackRemoved', () => ({
    publishTrackRemoved: mocks.publishTrackRemoved,
}));
vi.mock('../../../useCases/removeTrack', () => ({
    removeTrack: mocks.removeTrack,
}));
vi.mock('../../../useCases/removeTrackModulationReferences', () => ({
    removeTrackModulationReferences: mocks.removeTrackModulationReferences,
}));

describe('handleDiscardCreatedTrack', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.removeTrackModulationReferences.mockReturnValue(mocks.finalizeModulationRemoval);
    });

    it('removes a committed created track and publishes after commit', async () => {
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'created' },
        });

        expect(mocks.removeTrack).toHaveBeenCalledWith('created', {
            deferRuntimeEffects: true,
            suppressRemovedEvent: true,
        });
        expect(mocks.finalizeRuntimeRemoval).not.toHaveBeenCalled();
        expect(mocks.finalizeModulationRemoval).not.toHaveBeenCalled();
        expect(mocks.publishTrackRemoved).not.toHaveBeenCalled();
        expect(mocks.removeTrackModulationReferences).toHaveBeenCalledWith({
            trackId: 'created',
            deferRuntimeEffects: true,
        });

        if (!result) {
            throw new Error('Expected a written execution result');
        }
        await result.afterCommit?.();

        expect(mocks.finalizeRuntimeRemoval).toHaveBeenCalledOnce();
        expect(mocks.finalizeModulationRemoval).toHaveBeenCalledOnce();
        expect(mocks.publishTrackRemoved).toHaveBeenCalledWith({ trackId: 'created' });
    });

    it('succeeds idempotently when an aborted transaction already removed the track', async () => {
        mocks.removeTrack.mockReturnValue({ removed: false });

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'aborted' },
        });

        expect(result).toEqual({ status: 'written' });
        expect(mocks.removeTrackModulationReferences).not.toHaveBeenCalled();
        expect(mocks.publishTrackRemoved).not.toHaveBeenCalled();
    });

    it('is an internal non-undoable compensation action', () => {
        expect(handleDiscardCreatedTrack.undoable).toBe(false);
    });
});
