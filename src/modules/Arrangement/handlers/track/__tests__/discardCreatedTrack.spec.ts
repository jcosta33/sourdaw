import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDiscardCreatedTrack } from '../discardCreatedTrack';

const mocks = vi.hoisted(() => ({
    finalizeRuntimeRemoval: vi.fn(),
    finalizeModulationRemoval: vi.fn(),
    getTrackStoreState: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    publishTrackRemoved: vi.fn(),
    removeTrack: vi.fn(),
    removeTrackModulationReferences: vi.fn(),
    wireSidechainRoutes: vi.fn(),
}));

vi.mock('#/modules/Routing/useCases', () => ({
    wireSidechainRoutes: mocks.wireSidechainRoutes,
}));
vi.mock('../../../useCases/getTrackStoreState', () => ({
    getTrackStoreState: mocks.getTrackStoreState,
}));
vi.mock('../../../useCases/projectTrackToLiveStrip', () => ({
    projectTrackToLiveStrip: mocks.projectTrackToLiveStrip,
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
        mocks.removeTrackModulationReferences.mockReturnValue({
            afterCommit: mocks.finalizeModulationRemoval,
            afterAmbiguousCommit: mocks.finalizeModulationRemoval,
        });
    });

    it('certifies only snapshot-guarded discard compensation', () => {
        expect(
            handleDiscardCreatedTrack.canReapplyAfterDivergence?.({
                type: 'discardCreatedTrack',
                payload: {
                    trackId: 'created',
                    generatedMidiStateGuard: { entityJson: '{}', midiByClipIdJson: '{}' },
                },
            })
        ).toBe(true);
        expect(
            handleDiscardCreatedTrack.canReapplyAfterDivergence?.({
                type: 'discardCreatedTrack',
                payload: { trackId: 'created' },
            })
        ).toBe(false);
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

    it('rejects a guarded discard when the generated track was edited', async () => {
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'created', name: 'edited', clips: [] }],
        });

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: {
                trackId: 'created',
                generatedMidiStateGuard: {
                    entityJson: JSON.stringify({ id: 'created', name: 'original', clips: [] }),
                    midiByClipIdJson: JSON.stringify({}),
                },
            },
        });

        expect(result).toEqual({ status: 'conflict' });
        expect(mocks.removeTrack).not.toHaveBeenCalled();
        expect(mocks.removeTrackModulationReferences).not.toHaveBeenCalled();
    });

    it('rebuilds a created track that remains in durable truth after an ambiguous commit', async () => {
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'created' }] });

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'created' },
        });
        if (!result) {
            throw new Error('Expected a written execution result');
        }
        await result.afterAmbiguousCommit?.();

        expect(mocks.projectTrackToLiveStrip).toHaveBeenCalledWith({
            trackId: 'created',
            activateDormantExternalPlugins: true,
        });
        expect(mocks.finalizeRuntimeRemoval).not.toHaveBeenCalled();
        expect(mocks.publishTrackRemoved).not.toHaveBeenCalled();
        expect(mocks.wireSidechainRoutes).toHaveBeenCalledOnce();
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
