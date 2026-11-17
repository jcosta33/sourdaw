import { beforeEach, describe, expect, it, vi } from 'vitest';

import { handleDiscardCreatedTrack } from '../discardCreatedTrack';

const mocks = vi.hoisted(() => ({
    finalizeRuntimeRemoval: vi.fn(),
    finalizeModulationRemoval: vi.fn(),
    getAllSidechainRoutes: vi.fn(),
    getTrackStoreState: vi.fn(),
    projectTrackToLiveStrip: vi.fn(),
    publishTrackRemoved: vi.fn(),
    removeTrack: vi.fn(),
    removeTrackModulationReferences: vi.fn(),
    wireSidechainRoutes: vi.fn(),
    unloadPlugin: vi.fn(),
    clearReportedLatency: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    unloadPlugin: mocks.unloadPlugin,
    // The discard unload carries live state; its instance ids are this spec's subject.
    unloadPluginCarryingLiveState: mocks.unloadPlugin,
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    clearReportedLatency: mocks.clearReportedLatency,
}));

vi.mock('#/modules/Routing/useCases', () => ({
    wireSidechainRoutes: mocks.wireSidechainRoutes,
    getAllSidechainRoutes: mocks.getAllSidechainRoutes,
    hydrateSidechainRoutes: vi.fn(),
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

    it('accepts a reordered track capture after projecting an earlier clip inverse', () => {
        const track = {
            id: 'created',
            name: 'Created',
            freezeState: { status: 'unfrozen', renderedAt: 2 },
            devices: [],
            clips: [{ id: 'created-clip' }],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });
        const action = {
            type: 'discardCreatedTrack' as const,
            payload: {
                trackId: 'created',
                generatedMidiStateGuard: {
                    entityJson: JSON.stringify({
                        devices: [],
                        clips: [],
                        freezeState: { renderedAt: 2, status: 'unfrozen' },
                        name: 'Created',
                        id: 'created',
                    }),
                    midiByClipIdJson: '{}',
                },
            },
        };
        const validate = handleDiscardCreatedTrack.validate;
        if (!validate) {
            throw new Error('Expected discardCreatedTrack to provide validation');
        }

        expect(
            validate(action, {
                actions: [{ type: 'discardDuplicatedClip', payload: { clipId: 'created-clip' } }, action],
                actionIndex: 1,
            })
        ).toBe(true);
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
        mocks.getTrackStoreState.mockReturnValue({ tracks: [{ id: 'created', devices: [] }] });

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

    it('unloads every hosted plugin instance the discarded track held, after commit', async () => {
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'created',
                    devices: [
                        { id: 'dev-a', type: 'external-plugin', externalPluginId: 'p', externalInstanceId: 'p-1' },
                        { id: 'dev-b', type: 'external-plugin', externalPluginId: 'q', externalInstanceId: 'q-2' },
                        { id: 'dev-c', type: 'builtin-eq' },
                    ],
                },
            ],
        });
        mocks.unloadPlugin.mockResolvedValue(undefined);

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'created' },
        });
        if (!result) {
            throw new Error('Expected a written execution result');
        }
        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
        // The track leaves the store when removeTrack commits; later reads see it gone.
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        await result.afterCommit?.();

        expect(mocks.unloadPlugin.mock.calls.map(([instanceId]) => instanceId).sort()).toEqual(['p-1', 'q-2']);
        expect(mocks.clearReportedLatency.mock.calls.map(([deviceId]) => deviceId).sort()).toEqual(['dev-a', 'dev-b']);
    });

    it('still unloads and clears every instance when one teardown rejects, then rejects afterCommit', async () => {
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'created',
                    devices: [
                        { id: 'dev-a', type: 'external-plugin', externalPluginId: 'p', externalInstanceId: 'p-1' },
                        { id: 'dev-b', type: 'external-plugin', externalPluginId: 'q', externalInstanceId: 'q-2' },
                    ],
                },
            ],
        });
        mocks.unloadPlugin.mockRejectedValueOnce(new Error('host gone')).mockResolvedValueOnce(undefined);

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'created' },
        });
        if (!result) {
            throw new Error('Expected a written execution result');
        }
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });

        await expect(result.afterCommit?.()).rejects.toThrow(/p-1/);

        expect(mocks.unloadPlugin.mock.calls.map(([instanceId]) => instanceId)).toEqual(['p-1', 'q-2']);
        expect(mocks.clearReportedLatency.mock.calls.map(([deviceId]) => deviceId)).toEqual(['dev-a', 'dev-b']);
        expect(mocks.publishTrackRemoved).toHaveBeenCalledWith({ trackId: 'created' });
    });

    it('unloads every hosted instance after an ambiguous commit that left the track absent', async () => {
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [
                {
                    id: 'created',
                    devices: [
                        { id: 'dev-a', type: 'external-plugin', externalPluginId: 'p', externalInstanceId: 'p-1' },
                        { id: 'dev-b', type: 'external-plugin', externalPluginId: 'q', externalInstanceId: 'q-2' },
                    ],
                },
            ],
        });
        mocks.unloadPlugin.mockResolvedValue(undefined);

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'created' },
        });
        if (!result) {
            throw new Error('Expected a written execution result');
        }
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        await result.afterAmbiguousCommit?.();

        expect(mocks.unloadPlugin.mock.calls.map(([instanceId]) => instanceId)).toEqual(['p-1', 'q-2']);
    });

    it('keeps the hosted instances loaded when an ambiguous commit left the track present', async () => {
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });
        const track = {
            id: 'created',
            devices: [{ id: 'dev-a', type: 'external-plugin', externalPluginId: 'p', externalInstanceId: 'p-1' }],
        };
        mocks.getTrackStoreState.mockReturnValue({ tracks: [track] });

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'created' },
        });
        if (!result) {
            throw new Error('Expected a written execution result');
        }
        await result.afterAmbiguousCommit?.();

        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
    });

    it('requests no plugin unload for a discarded track without hosted plugins', async () => {
        mocks.removeTrack.mockReturnValue({
            removed: true,
            finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval,
        });
        mocks.getTrackStoreState.mockReturnValue({
            tracks: [{ id: 'created', devices: [{ id: 'dev-c', type: 'builtin-eq' }] }],
        });

        const result = await handleDiscardCreatedTrack.execute({
            type: 'discardCreatedTrack',
            payload: { trackId: 'created' },
        });
        if (!result) {
            throw new Error('Expected a written execution result');
        }
        mocks.getTrackStoreState.mockReturnValue({ tracks: [] });
        await result.afterCommit?.();

        expect(mocks.unloadPlugin).not.toHaveBeenCalled();
        expect(mocks.clearReportedLatency).not.toHaveBeenCalled();
    });

    describe('guard against the created track with captured plugin state (issue #6597)', () => {
        const createdDevice = {
            id: 'created-device',
            name: 'Hosted Synth',
            type: 'external',
            bypassed: false,
            parameterValues: { cutoff: 0.5 },
            externalPluginId: 'plugin-1',
            externalInstanceId: 'instance-1',
            externalStateChunk: 'c2F2ZWQ=',
        };
        const createdTrack = { id: 'created', name: 'Created', clips: [], sends: [], devices: [createdDevice] };
        const { externalStateChunk: _createdChunk, ...deviceWithoutChunk } = createdDevice;

        // Each live device diverges from the fingerprinted one; only the first two
        // diverge in the plugin's state chunk alone.
        const cases = [
            { drift: 'a different chunk', device: { ...createdDevice, externalStateChunk: 'ZWRpdGVk' }, admits: true },
            { drift: 'the chunk cleared', device: deviceWithoutChunk, admits: true },
            {
                drift: 'a new chunk and a bypass',
                device: { ...createdDevice, externalStateChunk: 'ZWRpdGVk', bypassed: true },
                admits: false,
            },
            { drift: 'a parameter', device: { ...createdDevice, parameterValues: { cutoff: 0.75 } }, admits: false },
            {
                drift: 'another plugin instance',
                device: { ...createdDevice, externalInstanceId: 'instance-2' },
                admits: false,
            },
            { drift: 'a rename', device: { ...createdDevice, name: 'Renamed' }, admits: false },
        ];

        function guardedDiscard() {
            return {
                type: 'discardCreatedTrack' as const,
                payload: {
                    trackId: 'created',
                    generatedMidiStateGuard: {
                        entityJson: JSON.stringify(createdTrack),
                        midiByClipIdJson: '{}',
                    },
                },
            };
        }

        beforeEach(() => {
            mocks.getAllSidechainRoutes.mockReturnValue([]);
            mocks.removeTrack.mockReturnValue({ removed: true, finalizeRuntimeRemoval: mocks.finalizeRuntimeRemoval });
        });

        it.each(cases)('validate admits only chunk drift: $drift', ({ device, admits }) => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ ...createdTrack, devices: [device] }] });
            const action = guardedDiscard();
            const validate = handleDiscardCreatedTrack.validate;
            if (!validate) {
                throw new Error('Expected discardCreatedTrack to provide validation');
            }

            expect(validate(action, { actions: [action], actionIndex: 0 })).toBe(admits);
        });

        // The chunk exemption strips device state alone: a created track's clips still
        // count on the validate route whose guard names no MIDI clip.
        const createdClip = { id: 'created-clip', trackId: 'created', name: 'Take', startBeat: 0, endBeat: 4 };
        const clipCases = [
            { drift: 'none', clip: createdClip, admits: true },
            { drift: 'a clip rename', clip: { ...createdClip, name: 'Renamed take' }, admits: false },
            { drift: 'a clip move', clip: { ...createdClip, startBeat: 1 }, admits: false },
        ];

        it.each(clipCases)('validate still compares the created clips: $drift', ({ clip, admits }) => {
            const trackWithClip = { ...createdTrack, clips: [createdClip] };
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ ...trackWithClip, clips: [clip] }] });
            const action = {
                type: 'discardCreatedTrack' as const,
                payload: {
                    trackId: 'created',
                    generatedMidiStateGuard: { entityJson: JSON.stringify(trackWithClip), midiByClipIdJson: '{}' },
                },
            };
            const validate = handleDiscardCreatedTrack.validate;
            if (!validate) {
                throw new Error('Expected discardCreatedTrack to provide validation');
            }

            expect(validate(action, { actions: [action], actionIndex: 0 })).toBe(admits);
        });

        it.each(cases)('execute admits only chunk drift: $drift', async ({ device, admits }) => {
            mocks.getTrackStoreState.mockReturnValue({ tracks: [{ ...createdTrack, devices: [device] }] });

            const result = await handleDiscardCreatedTrack.execute(guardedDiscard());

            expect(result?.status).toBe(admits ? 'written' : 'conflict');
            expect(mocks.removeTrack).toHaveBeenCalledTimes(admits ? 1 : 0);
        });
    });

    it('is an internal non-undoable compensation action', () => {
        expect(handleDiscardCreatedTrack.undoable).toBe(false);
    });
});
