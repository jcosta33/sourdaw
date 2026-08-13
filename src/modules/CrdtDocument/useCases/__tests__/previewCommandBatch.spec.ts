import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '#/infra/store/createStore';
import { createAutomergeStorage, flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
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
});
