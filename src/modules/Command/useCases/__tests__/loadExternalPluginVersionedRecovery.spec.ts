import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { createTrack, getArrangementHandlers, getTrackStoreState, setTrackState } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    activateExternalPlugin,
    clearLoadedExternalPlugins,
    resetExternalPluginRuntimeForGraphRebuild,
} from '#/modules/PluginHost/useCases';

import { type VersionedCommandBatchEnvelope } from '../../models/VersionedCommandBatchEnvelope';
import { commandBatchPreviewPort } from '../commandBatchPreviewPort';
import { commandRuntimeRepairPort } from '../commandRuntimeRepairPort';
import { createVerifiedBatchReceipt } from '../createVerifiedBatchReceipt';
import { createVersionedCommandEnvelope } from '../createVersionedCommandEnvelope';
import { createVersionedCommandReceipt } from '../createVersionedCommandReceipt';
import { getCommandBatchContentHash } from '../getCommandBatchContentHash';
import { reconcileProjectCommandBatchEffects } from '../reconcileProjectCommandBatchEffects';

const mocks = vi.hoisted(() => ({
    activateExternalPlugin: vi.fn(),
    clearLoadedExternalPlugins: vi.fn(),
    findSupportedPlugin: vi.fn(),
    resetExternalPluginRuntimeForGraphRebuild: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    activateExternalPlugin: mocks.activateExternalPlugin,
    clearLoadedExternalPlugins: mocks.clearLoadedExternalPlugins,
    findSupportedPlugin: mocks.findSupportedPlugin,
    resetExternalPluginRuntimeForGraphRebuild: mocks.resetExternalPluginRuntimeForGraphRebuild,
}));

/**
 * The rate the engine renders at in this scenario. Both activations state it,
 * because recovery has to reach the plugin on the same clock the first attempt
 * did — a repair that re-activated at a different rate would restore a detuned
 * instance and call it recovered. Deliberately neither 44100 nor 48000: those
 * are the rates a substituting accessor falls back to, so an assertion stated
 * at one of them would pass against a caller that never read the engine.
 */
const ENGINE_SAMPLE_RATE = 96_000;

const baseRevision = JSON.stringify({
    documentIdentityEpoch: 1,
    mutationEpoch: 0,
    documents: [{ docId: 'root', heads: ['head-0'] }],
});

describe('loadExternalPlugin versioned recovery', () => {
    let projectDocument: Record<string, unknown>;

    beforeEach(() => {
        vi.clearAllMocks();
        clearLoadedExternalPlugins();
        clearHandlerRegistry();
        commandBatchPreviewPort.setRecoveryProvider(null);
        commandRuntimeRepairPort.setProvider(null);
        projectDocument = {};
        configureAutomergeStoragePort({
            getDoc: () => projectDocument,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                const draft = structuredClone(projectDocument);
                changeFn(draft);
                projectDocument = draft;
            },
        });
        mocks.findSupportedPlugin.mockReturnValue({
            id: 'plugin-1',
            descriptor_id: 'plugin-1',
            name: 'External Compressor',
            vendor: 'Test',
            format: 'vst3',
            category: 'Effect',
            path: '/plugins/compressor.vst3',
            version: '1.0.0',
            num_inputs: 2,
            num_outputs: 2,
            num_parameters: 0,
            has_custom_ui: false,
        });
    });

    afterEach(() => {
        setTrackState({ tracks: [], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        clearLoadedExternalPlugins();
        clearHandlerRegistry();
        commandBatchPreviewPort.setRecoveryProvider(null);
        commandRuntimeRepairPort.setProvider(null);
    });

    it('rebuilds a failed attachment from project truth with the stable persisted instance id', async () => {
        const persistedDevice = {
            id: 'device-external-stable',
            name: 'External Compressor',
            type: 'external-plugin' as const,
            bypassed: false,
            parameterValues: {},
            externalInstanceId: 'plugin-1-stable-instance',
            externalPluginId: 'plugin-1',
        };
        const projectTrack = createTrack({ id: 'audio-1', kind: 'audio', name: 'Audio' });
        setTrackState({
            tracks: [{ ...projectTrack, devices: [persistedDevice] }],
            selectedTrackId: 'audio-1',
            ghostClips: [],
        });
        flushAutomergeStorageWrites();
        mocks.activateExternalPlugin
            .mockResolvedValueOnce({ status: 'failed', stage: 'attach', reason: 'native engine unavailable' })
            .mockResolvedValueOnce({ status: 'active' });
        mocks.resetExternalPluginRuntimeForGraphRebuild.mockResolvedValue(undefined);
        await expect(
            activateExternalPlugin({
                pluginId: persistedDevice.externalPluginId,
                instanceId: persistedDevice.externalInstanceId,
                engineSampleRate: ENGINE_SAMPLE_RATE,
            })
        ).resolves.toMatchObject({ status: 'failed' });

        const command = createVersionedCommandEnvelope({
            action: {
                type: 'loadExternalPlugin',
                payload: { pluginId: persistedDevice.externalPluginId, trackId: 'audio-1' },
            },
            availableDeviceVersions: {},
            applicationAssignedIds: [],
            expectedEffect: 'Load External Compressor on Audio.',
            normalizedProjectRevision: baseRevision,
            objectReferences: [{ argument: 'trackId', id: 'audio-1', scope: 'stable' }],
            parameterUnits: [],
            reason: 'Add the selected external effect.',
            time: [],
        });
        const envelope: VersionedCommandBatchEnvelope = {
            schemaVersion: 1,
            runId: 'run-plugin-recovery',
            batchId: 'batch-plugin-recovery',
            projectId: 'project-plugin-recovery',
            baseRevision,
            idempotencyKey: 'plugin-recovery-request',
            intent: 'Load External Compressor',
            mode: 'commit',
            scope: {
                targetIds: ['audio-1'],
                targetRanges: [],
                protectedTargetIds: [],
                protectedRanges: [],
            },
            preconditions: [],
            commands: [command],
            postconditions: [],
            dependencies: [],
            batchLocalBindings: [],
            grants: {
                allowedOperationPrefixes: ['loadExternalPlugin'],
                create: false,
                delete: false,
                routing: false,
                tempo: false,
                master: false,
                file: false,
                audioUpload: false,
                remoteGeneration: false,
                autoCommit: false,
            },
            budgets: {
                maxCommands: 1,
                maxCreatedTracks: 0,
                maxDeletedObjects: 0,
                maxAffectedTracks: 1,
                maxAffectedClips: 0,
                maxAutomationPoints: 0,
                maxImportedAssets: 0,
                maxRenderJobs: 0,
            },
        };
        const contentHash = await getCommandBatchContentHash(envelope);
        const receipt = createVerifiedBatchReceipt({
            contentHash,
            envelope,
            observedBaseRevision: baseRevision,
            resultingRevision: baseRevision,
            result: {
                status: 'committed-with-warning',
                actions: [
                    {
                        action: {
                            type: 'loadExternalPlugin',
                            payload: { pluginId: persistedDevice.externalPluginId, trackId: 'audio-1' },
                        },
                        receipt: createVersionedCommandReceipt({ envelope: command }),
                    },
                ],
                warning: 'The project commit succeeded, but the runtime graph needs repair.',
                warningDetails: [
                    {
                        kind: 'external-effect',
                        commandId: command.commandId,
                        message: 'The native plugin host needs a graph rebuild.',
                        pendingEffect: {
                            commandId: command.commandId,
                            kind: 'runtime-graph',
                            operation: 'loadExternalPlugin',
                            reason: 'The native plugin host needs a graph rebuild.',
                            remediation: 'repair',
                            state: 'pending',
                        },
                    },
                ],
            },
        });

        registerHandlerMap({ loadExternalPlugin: getArrangementHandlers().loadExternalPlugin });
        const createRecovery = vi.fn(() => {
            throw new Error('runtime graph repair must not require an isolated project preview');
        });
        commandBatchPreviewPort.setRecoveryProvider(createRecovery);
        const repairRuntimeFromProject = vi.fn(async () => {
            await resetExternalPluginRuntimeForGraphRebuild();
            const currentDevice = getTrackStoreState()?.tracks[0]?.devices[0];
            if (!currentDevice?.externalPluginId || !currentDevice.externalInstanceId) {
                throw new Error('Persisted external plugin identity is unavailable');
            }
            const activation = await activateExternalPlugin({
                pluginId: currentDevice.externalPluginId,
                instanceId: currentDevice.externalInstanceId,
                engineSampleRate: ENGINE_SAMPLE_RATE,
            });
            if (activation.status === 'failed') {
                throw new Error(activation.reason);
            }
        });
        commandRuntimeRepairPort.setProvider(repairRuntimeFromProject);

        await expect(
            reconcileProjectCommandBatchEffects({
                contentHash,
                envelope,
                serializedReceipt: JSON.stringify(receipt),
            })
        ).resolves.toEqual({ status: 'reconciled' });

        expect(createRecovery).not.toHaveBeenCalled();
        expect(repairRuntimeFromProject).toHaveBeenCalledOnce();
        expect(mocks.resetExternalPluginRuntimeForGraphRebuild).toHaveBeenCalledOnce();
        expect(mocks.activateExternalPlugin).toHaveBeenNthCalledWith(1, {
            pluginId: persistedDevice.externalPluginId,
            instanceId: persistedDevice.externalInstanceId,
            engineSampleRate: ENGINE_SAMPLE_RATE,
        });
        // The rebuild reaches the same instance identity on the same clock as
        // the attempt it is recovering from.
        expect(mocks.activateExternalPlugin).toHaveBeenNthCalledWith(2, {
            pluginId: persistedDevice.externalPluginId,
            instanceId: persistedDevice.externalInstanceId,
            engineSampleRate: ENGINE_SAMPLE_RATE,
        });
        expect(getTrackStoreState()?.tracks[0]?.devices).toEqual([persistedDevice]);
    });
});
