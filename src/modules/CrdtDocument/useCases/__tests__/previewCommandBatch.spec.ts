import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage, flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandDeviceVersionsPort,
    commandProjectRevisionPort,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState, getTransportHandlers } from '#/modules/Transport/useCases';

const runtimeMocks = vi.hoisted(() => ({
    addDeviceToStrip: vi.fn(),
    updateDeviceParam: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    addDeviceToStrip: runtimeMocks.addDeviceToStrip,
    updateDeviceParam: runtimeMocks.updateDeviceParam,
}));

import { automergeRepository } from '../../repositories/automergeRepository';
import { captureProjectRevision } from '../captureProjectRevision';
import { createCommandPreviewWorkspace } from '../createCommandPreviewWorkspace';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';

describe('previewCommandBatch', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('preview');
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.tempo = { bpm: 100 };
        });
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
        commandDeviceVersionsPort.setDeviceTypeResolver(() => ({}));
        commandDeviceVersionsPort.setResolver(() => undefined);
    });

    it('previews the registered production tempo command without changing live transport truth', async () => {
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.transport = { ...defaultTransportState, tempo: 100 };
            document.tempoMap = { changes: [] };
        });
        transportStore.hydrate();
        tempoMapStore.hydrate();
        registerHandlerMap(getTransportHandlers());
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-preview',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 120 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 120 beats per minute.',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Preview a tempo change.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-production-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview tempo change',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-production-preview',
        });

        const preview = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(preview.status, JSON.stringify(preview)).toBe('previewed');
        expect(preview).toMatchObject({
            status: 'previewed',
            projectDocument: { transport: { tempo: 120 } },
            semanticDiff: {
                schemaVersion: 1,
                baseRevision: revision,
                batchId: 'batch-production-preview',
                summary: 'Preview tempo change',
                estimatedAudioImpact: { level: 'structural' },
                facts: {
                    project: [expect.objectContaining({ commandId: command.commandId })],
                },
            },
        });
        expect(transportStore.value?.tempo).toBe(100);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')?.transport).toMatchObject({ tempo: 100 });
        if (preview.status !== 'previewed') {
            throw new Error('Expected a production preview resource');
        }
        preview.resource.release();
    });

    it('previews a registered production addTrack command without publishing the track', async () => {
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.tracks = defaultTrackState;
        });
        trackStore.hydrate();
        registerHandlerMap({ addTrack: getArrangementHandlers().addTrack });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-preview',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'addTrack',
                payload: {
                    color: 'oklch(0.40 0.08 250)',
                    id: 'track-preview',
                    initialAlternativeId: 'alternative-preview',
                    kind: 'audio',
                    name: 'Preview Audio',
                },
            },
            applicationAssignedIds: [
                { argument: 'id', value: 'track-preview' },
                { argument: 'initialAlternativeId', value: 'alternative-preview' },
            ],
            availableDeviceVersions: {},
            expectedEffect: 'One audio track is added.',
            normalizedProjectRevision: revision,
            objectReferences: [
                { argument: 'id', id: 'track-preview', scope: 'stable' },
                { argument: 'initialAlternativeId', id: 'alternative-preview', scope: 'stable' },
            ],
            parameterUnits: [],
            reason: 'Preview adding one track.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-production-add-track-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview adding one track',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-production-add-track-preview',
        });

        const preview = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(preview.status, JSON.stringify(preview)).toBe('previewed');
        expect(preview).toMatchObject({
            status: 'previewed',
            projectDocument: {
                tracks: {
                    tracks: [expect.objectContaining({ id: 'track-preview', name: 'Preview Audio' })],
                },
            },
        });
        expect(trackStore.value).toEqual(defaultTrackState);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')?.tracks).toEqual(defaultTrackState);
        if (preview.status !== 'previewed') {
            throw new Error('Expected an addTrack preview resource');
        }
        preview.resource.release();
    });

    it('previews a production device-parameter handler without touching the live audio engine', async () => {
        const track = createTrack({ id: 'track-audio', name: 'Audio', kind: 'audio' });
        track.devices.push({
            id: 'device-compressor',
            name: 'Compressor',
            type: 'builtin-compressor',
            bypassed: false,
            parameterValues: { 'comp-threshold': -24 },
        });
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.tracks = { ...defaultTrackState, tracks: [track] };
        });
        trackStore.hydrate();
        registerHandlerMap({ setDeviceParameter: getArrangementHandlers().setDeviceParameter });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-preview',
            projectInvariantsValid: true,
            targetFingerprints: {
                'comp-threshold': 'parameter:comp-threshold',
                'device-compressor': 'device:device-compressor',
            },
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'setDeviceParameter',
                payload: { deviceId: 'device-compressor', paramId: 'comp-threshold', value: -18 },
            },
            availableDeviceVersions: {},
            expectedEffect: 'Compressor threshold becomes -18 dB.',
            normalizedProjectRevision: revision,
            objectReferences: [
                { argument: 'deviceId', id: 'device-compressor', scope: 'stable' },
                { argument: 'paramId', id: 'comp-threshold', scope: 'stable' },
            ],
            parameterUnits: [{ argument: 'value', unit: 'unitless' }],
            reason: 'Preview a compressor parameter change.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-production-device-parameter-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview a compressor parameter change',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-production-device-parameter-preview',
        });

        const preview = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(preview).toMatchObject({
            status: 'previewed',
            projectDocument: {
                tracks: {
                    tracks: [
                        expect.objectContaining({
                            id: 'track-audio',
                            devices: [
                                expect.objectContaining({
                                    id: 'device-compressor',
                                    parameterValues: { 'comp-threshold': -18 },
                                }),
                            ],
                        }),
                    ],
                },
            },
        });
        expect(runtimeMocks.updateDeviceParam).not.toHaveBeenCalled();
        expect(trackStore.value?.tracks[0]?.devices[0]?.parameterValues['comp-threshold']).toBe(-24);
        if (preview.status !== 'previewed') {
            throw new Error('Expected a device parameter preview resource');
        }
        preview.resource.release();
    });

    it('previews a production add-device handler without creating a live device node', async () => {
        const track = createTrack({ id: 'track-audio', name: 'Audio', kind: 'audio' });
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.tracks = { ...defaultTrackState, tracks: [track] };
        });
        trackStore.hydrate();
        registerHandlerMap({ addDevice: getArrangementHandlers().addDevice });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-preview',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-audio': 'track:track-audio' },
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: {
                type: 'addDevice',
                payload: {
                    trackId: 'track-audio',
                    deviceType: 'builtin-compressor',
                    deviceId: 'device-preview',
                },
            },
            applicationAssignedIds: [{ argument: 'deviceId', value: 'device-preview' }],
            availableDeviceVersions: {},
            expectedEffect: 'A compressor is added to the audio track.',
            normalizedProjectRevision: revision,
            objectReferences: [
                { argument: 'trackId', id: 'track-audio', scope: 'stable' },
                { argument: 'deviceId', id: 'device-preview', scope: 'stable' },
            ],
            parameterUnits: [],
            reason: 'Preview adding a compressor.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-production-add-device-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview adding a compressor',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-production-add-device-preview',
        });

        const preview = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(preview).toMatchObject({
            status: 'previewed',
            projectDocument: {
                tracks: {
                    tracks: [
                        expect.objectContaining({
                            id: 'track-audio',
                            devices: [expect.objectContaining({ id: 'device-preview', type: 'builtin-compressor' })],
                        }),
                    ],
                },
            },
        });
        expect(runtimeMocks.addDeviceToStrip).not.toHaveBeenCalled();
        expect(trackStore.value?.tracks[0]?.devices).toEqual([]);
        if (preview.status !== 'previewed') {
            throw new Error('Expected an add-device preview resource');
        }
        preview.resource.release();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandBatchPreviewPort.setProvider(null);
        commandDeviceVersionsPort.setDeviceTypeResolver(null);
        commandDeviceVersionsPort.setResolver(null);
        commandProjectRevisionPort.setProvider(null);
        automergeRepository.reset();
        vi.restoreAllMocks();
    });

    it('applies the commit handler to isolated CRDT state and releases its owned preview resource', async () => {
        let ownedWorkspace: ReturnType<typeof createCommandPreviewWorkspace> | null = null;
        commandBatchPreviewPort.setProvider((baseRevision) => {
            ownedWorkspace = createCommandPreviewWorkspace(baseRevision);
            return ownedWorkspace;
        });
        const tempoStore = createStore({
            storage: createAutomergeStorage<{ bpm: number }>('root', 'tempo'),
        });
        tempoStore.hydrate();
        const execute = vi.fn((action: { payload: { bpm: number } }) => {
            tempoStore.set({ bpm: action.payload.bpm });
            return { status: 'written' as const };
        });
        registerHandlerMap({
            setTempo: {
                describe: () => ({
                    inverseAction: { type: 'setTempo', payload: { bpm: tempoStore.value?.bpm ?? 100 } },
                    label: 'Set tempo to 120 BPM',
                }),
                execute,
                previewExecution: 'isolated-project',
                requiresAbortCompensation: false,
                undoable: true,
                validate: () => true,
            },
        });
        const inspectedDocuments: Array<Readonly<Record<string, unknown>> | undefined> = [];
        commandBatchPreflightPort.setProvider((input) => {
            inspectedDocuments.push(input.projectDocument);
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-preview',
                projectInvariantsValid: true,
                targetFingerprints: {},
            };
        });
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 120 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 120 beats per minute.',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Preview a tempo change.',
            time: [],
        });
        const previewBatch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview tempo change',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-preview',
        });
        const liveDocumentBefore = JSON.stringify(automergeRepository.getDoc<Record<string, unknown>>('root'));
        const liveHeadsBefore = automergeRepository.getHeads('root');
        const observedLiveValues: Array<{ bpm: number } | null> = [];
        const unsubscribe = tempoStore.subscribe((value) => observedLiveValues.push(value));

        const preview = await executeVersionedCommandBatchEnvelope({
            authority: previewBatch.authority,
            serialized: previewBatch.serialized,
            options: { skipUndo: true },
        });

        expect(preview).toMatchObject({
            status: 'previewed',
            audioGraphValid: true,
            baseRevision: revision,
            projectDocument: { tempo: { bpm: 120 } },
            projectInvariantsValid: true,
        });
        expect(execute).toHaveBeenCalledTimes(1);
        expect(tempoStore.value).toEqual({ bpm: 100 });
        expect(JSON.stringify(automergeRepository.getDoc('root'))).toBe(liveDocumentBefore);
        expect(automergeRepository.getHeads('root')).toEqual(liveHeadsBefore);
        expect(captureProjectRevision()).toBe(revision);
        expect(observedLiveValues).toEqual([]);
        expect(inspectedDocuments).toEqual([undefined, expect.objectContaining({ tempo: { bpm: 120 } })]);

        if (preview.status !== 'previewed') {
            throw new Error('Expected a preview resource');
        }
        preview.resource.release();
        preview.resource.release();
        expect(() => ownedWorkspace?.getProjectDocument()).toThrowError('Command preview has been released');

        const commitBatch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-commit',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Commit tempo change',
            mode: 'commit',
            projectId: 'project-preview',
            runId: 'run-commit',
        });
        const committed = await executeVersionedCommandBatchEnvelope({
            authority: commitBatch.authority,
            confirmed: true,
            serialized: commitBatch.serialized,
            options: { skipUndo: true },
        });

        expect(committed.status, JSON.stringify(committed)).toBe('committed');
        expect(execute).toHaveBeenCalledTimes(2);
        expect(tempoStore.value).toEqual({ bpm: 120 });
        unsubscribe();
    });

    it('rejects a handler with pre-commit runtime ownership before its first effect', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTempo: {
                describe: () => ({ label: 'Set tempo' }),
                execute,
                undoable: false,
                validate: () => true,
            },
        });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-preview',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 120 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 120 beats per minute.',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Preview a tempo change.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-unsafe-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview tempo change',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-unsafe-preview',
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Action cannot execute inside an isolated preview: setTempo',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
        expect(automergeRepository.getDoc('root')).toMatchObject({ tempo: { bpm: 100 } });
    });

    it('rejects an uncertified thenable handler before it can escape the isolated scope', async () => {
        const tempoStore = createStore({
            storage: createAutomergeStorage<{ bpm: number }>('root', 'tempo'),
        });
        tempoStore.hydrate();
        const execute = vi.fn(() => Promise.resolve().then(() => tempoStore.set({ bpm: 120 })));
        registerHandlerMap({
            setTempo: {
                describe: () => ({ label: 'Set tempo' }),
                execute,
                undoable: false,
                validate: () => true,
            },
        });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-preview',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 120 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 120 beats per minute.',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Preview a tempo change.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-thenable-preview',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview tempo change',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-thenable-preview',
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });
        await Promise.resolve();

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Action cannot execute inside an isolated preview: setTempo',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
        expect(tempoStore.value).toEqual({ bpm: 100 });
    });

    it('returns a typed rejection when workspace acquisition fails', async () => {
        registerHandlerMap({
            setTempo: {
                describe: () => ({ label: 'Set tempo' }),
                execute: () => ({ status: 'written' as const }),
                previewExecution: 'isolated-project',
                undoable: false,
                validate: () => true,
            },
        });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-preview',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        commandBatchPreviewPort.setProvider(() => {
            throw new Error('stale preview revision');
        });
        const revision = captureProjectRevision();
        const command = createVersionedCommandEnvelope({
            action: { type: 'setTempo', payload: { bpm: 120 } },
            availableDeviceVersions: {},
            expectedEffect: 'Tempo becomes 120 beats per minute.',
            normalizedProjectRevision: revision,
            objectReferences: [],
            parameterUnits: [{ argument: 'bpm', unit: 'beats-per-minute' }],
            reason: 'Preview a tempo change.',
            time: [],
        });
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision: revision,
            batchId: 'batch-provider-failure',
            commands: [serializeVersionedCommandEnvelope(command)],
            intent: 'Preview tempo change',
            mode: 'preview',
            projectId: 'project-preview',
            runId: 'run-provider-failure',
        });

        await expect(
            executeVersionedCommandBatchEnvelope({ authority: batch.authority, serialized: batch.serialized })
        ).resolves.toEqual({
            status: 'rejected',
            reason: 'Command batch preview workspace is unavailable: stale preview revision',
            actions: [],
        });
        expect(automergeRepository.getDoc('root')).toMatchObject({ tempo: { bpm: 100 } });
    });
});
