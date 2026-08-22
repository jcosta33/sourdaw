import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import { clearUndoHistory, executeAppAction, isAppActionCommittedError } from '#/modules/Command/useCases';

import { createTrack } from '../../../models/Track';
import { trackStore } from '../../../stores/trackStore';
import { handleLoadExternalPlugin } from '../handleLoadExternalPlugin';

const mocks = vi.hoisted(() => ({
    activateExternalPlugin: vi.fn(),
    applyDeviceChainRuntimeDelta: vi.fn(() => ({ acceptance: 'accepted', application: 'applied' })),
    findSupportedPlugin: vi.fn(),
    reportLatency: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    activateExternalPlugin: mocks.activateExternalPlugin,
    findSupportedPlugin: mocks.findSupportedPlugin,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({ reportLatency: mocks.reportLatency }));

vi.mock('../../../useCases/device/applyDeviceChainRuntimeDelta', () => ({
    applyDeviceChainRuntimeDelta: mocks.applyDeviceChainRuntimeDelta,
}));

function seedAudioTrack(): void {
    const track = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    flushAutomergeStorageWrites();
}

function configureStoragePort(onMutate: () => void): void {
    const document: Record<string, unknown> = {};
    configureAutomergeStoragePort({
        getDoc: () => document,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            onMutate();
            changeFn(document);
        },
    });
}

describe('handleLoadExternalPlugin command path', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        seedAudioTrack();
        clearHandlerRegistry();
        registerHandlerMap({ loadExternalPlugin: handleLoadExternalPlugin });
        clearUndoHistory();
        mocks.findSupportedPlugin.mockReturnValue({ id: 'plugin-1', name: 'External Compressor', category: 'Effect' });
    });

    afterEach(() => {
        clearUndoHistory();
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
    });

    it('leaves no runtime graph or host instance when the Command CRDT transaction aborts', async () => {
        configureStoragePort(() => {
            throw new Error('test CRDT commit failure');
        });

        await expect(
            executeAppAction({
                type: 'loadExternalPlugin',
                payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
            })
        ).rejects.toThrow('test CRDT commit failure');

        expect(trackStore.value?.tracks[0]?.devices ?? []).toEqual([]);
        expect(mocks.applyDeviceChainRuntimeDelta).not.toHaveBeenCalled();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });

    it.each([
        [
            'runtime rejection before any live effect',
            { acceptance: 'rejected', application: 'not-applied', reason: 'runtime revision is stale' },
            'retry',
        ],
        [
            'runtime reconciliation requirement after a partial live effect',
            {
                acceptance: 'accepted',
                application: 'needs-reconcile',
                compensation: 'failed',
                correlation: { appRevision: 3, projectRevision: 'project-3' },
                reason: 'device rebuild left live graph unhealthy',
                runtimeRevision: 4,
            },
            'repair',
        ],
    ])('does not report clean command success after %s', async (_label, runtimeResult, remediation) => {
        configureStoragePort(() => undefined);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue(runtimeResult);

        const committedError = await executeAppAction({
            type: 'loadExternalPlugin',
            payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
        }).then(
            () => {
                throw new Error('Expected committed runtime failure');
            },
            (error: unknown) => error
        );

        expect(isAppActionCommittedError(committedError)).toBe(true);
        if (
            !(committedError instanceof Error) ||
            !isAppActionCommittedError(committedError) ||
            !(committedError.cause instanceof AggregateError)
        ) {
            throw new Error('Expected the Command post-commit receipt to retain the runtime failure');
        }
        expect(committedError.cause.errors).toHaveLength(2);
        for (const runtimeFailure of committedError.cause.errors) {
            expect(runtimeFailure).toMatchObject({
                name: 'RuntimeDeviceDeltaPostCommitError',
                outcome: runtimeResult,
                remediation,
            });
        }

        expect(trackStore.value?.tracks[0]?.devices).toHaveLength(1);
        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
        expect(undoStore.value?.past).toHaveLength(0);
    });

    it('returns clean command success and activates no instance when the delta is superseded', async () => {
        // The host track left project truth later in this commit. Activating a
        // native plugin instance onto a strip that is being torn down would
        // leak the instance, so the whole runtime effect is void — not a
        // failure demanding manual repair.
        configureStoragePort(() => undefined);
        mocks.applyDeviceChainRuntimeDelta.mockReturnValue({
            acceptance: 'superseded',
            application: 'not-applied',
            reason: 'Track audio-1 left project truth before its add-device delta was submitted',
        });

        await expect(
            executeAppAction({ type: 'loadExternalPlugin', payload: { pluginId: 'plugin-1', trackId: 'audio-1' } })
        ).resolves.toBeUndefined();

        expect(mocks.applyDeviceChainRuntimeDelta).toHaveBeenCalledOnce();
        expect(mocks.activateExternalPlugin).not.toHaveBeenCalled();
    });

    it('commits project truth before running the device delta and host activation', async () => {
        const effects: string[] = [];
        configureStoragePort(() => {
            effects.push('project-commit');
        });
        mocks.applyDeviceChainRuntimeDelta.mockImplementation(() => {
            effects.push('runtime-delta');
            return { acceptance: 'accepted', application: 'applied' };
        });
        mocks.activateExternalPlugin.mockImplementation(() => {
            effects.push('host-activation');
        });

        await expect(
            executeAppAction({
                type: 'loadExternalPlugin',
                payload: { pluginId: 'plugin-1', trackId: 'audio-1' },
            })
        ).resolves.toBeUndefined();

        const device = trackStore.value?.tracks[0]?.devices[0];
        expect(device).toMatchObject({
            type: 'external-plugin',
            externalPluginId: 'plugin-1',
            externalInstanceId: expect.any(String),
        });
        expect(effects).toEqual(['project-commit', 'runtime-delta', 'host-activation']);
        expect(mocks.activateExternalPlugin).toHaveBeenCalledWith(
            expect.objectContaining({
                pluginId: 'plugin-1',
                instanceId: device?.externalInstanceId,
            })
        );
        const activation = mocks.activateExternalPlugin.mock.calls[0]?.[0];
        expect(activation?.onLatencyMs).toEqual(expect.any(Function));
        activation?.onLatencyMs?.(12.5);
        expect(mocks.reportLatency).toHaveBeenCalledWith(device?.id, 12.5);
        // The existing command contract deliberately has no inverse for a
        // newly materialized external instance; this route must not invent one.
        expect(undoStore.value?.past).toHaveLength(0);
    });
});
