import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import { createStore } from '#/infra/store/createStore';
import {
    countPendingAutomergeStorageWrites,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    commandBatchPreflightPort,
    commandBatchPreviewPort,
    commandDeviceVersionsPort,
    commandProjectRevisionPort,
    compilePartialCommandBatchAcceptance,
    compileVersionedCommandBatchEnvelope,
    createVersionedCommandEnvelope,
    executeVersionedCommandBatchEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { arrangementStore, defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';
import { tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { defaultTransportState, getTransportHandlers } from '#/modules/Transport/useCases';

import { automergeRepository } from '../../repositories/automergeRepository';
import { actionHistoryStore } from '../../stores/actionHistoryStore';
import { captureProjectMutationAuthorization } from '../captureProjectMutationAuthorization';
import { captureProjectRevision } from '../captureProjectRevision';
import { createCommandPreviewWorkspace } from '../createCommandPreviewWorkspace';
import { registerCrdtStorageRuntime } from '../registerCrdtStorageRuntime';
import { settledProjectRevisionMatchesLiveIgnoringSaveWrites } from '../settledProjectRevisionMatchesLiveIgnoringSaveWrites';

function seedSaveCheckpoint(): void {
    projectStore.set(structuredClone(defaultProjectStoreState));
    arrangementStore.set({
        activeArrangementId: 'arrangement-save',
        arrangements: [
            {
                id: 'inactive',
                name: 'Inactive',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
            {
                id: 'arrangement-save',
                name: 'Save',
                tracks: { tracks: [], selectedTrackId: null },
                automation: { lanes: [] },
                midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
            },
        ],
    });
    flushAutomergeStorageWrites();
}

async function writeSaveCheckpoint(): Promise<void> {
    registerSupportingServicePorts();
    const project = projectStore.value;
    if (!project) {
        throw new Error('Expected a savable project');
    }
    projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000 });
    await buildProjectData({ includeAudioBuffers: false });
    flushAutomergeStorageWrites();
}

describe('command preview save and content authority', () => {
    beforeEach(() => {
        automergeRepository.reset();
        automergeRepository.createProject('preview');
        automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
            document.tempo = { bpm: 100 };
        });
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        commandProjectRevisionPort.setProvider(captureProjectRevision);
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(settledProjectRevisionMatchesLiveIgnoringSaveWrites);
        commandBatchPreviewPort.setProvider(createCommandPreviewWorkspace);
        commandDeviceVersionsPort.setDeviceTypeResolver(() => ({}));
        commandDeviceVersionsPort.setResolver(() => undefined);
    });

    it.each(['commit', 'abort'] as const)(
        'refuses a public preview inside a buffered live transaction while preserving its later %s',
        async (terminal) => {
            automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
                document.transport = { ...defaultTransportState, tempo: 100 };
                document.tempoMap = { changes: [] };
            });
            transportStore.hydrate();
            tempoMapStore.hydrate();
            registerHandlerMap(getTransportHandlers());
            commandProjectRevisionPort.configureMutationAuthority({
                revisionProvider: captureProjectRevision,
                captureMutationAuthorization: captureProjectMutationAuthorization,
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
            seedSaveCheckpoint();
            const storage = createAutomergeStorage<{ gain: number }>('root', 'workspaceGain');
            storage.set({ gain: 1 });
            flushAutomergeStorageWrites();
            const revision = captureProjectRevision();
            const documentBefore = JSON.stringify(automergeRepository.getDoc('root'));
            const historyBefore = JSON.stringify(actionHistoryStore.value);
            const pendingBefore = countPendingAutomergeStorageWrites();
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
                batchId: 'batch-buffered-owner-preview',
                commands: [serializeVersionedCommandEnvelope(command)],
                intent: 'Preview tempo change',
                mode: 'preview',
                projectId: 'project-preview',
                runId: 'run-buffered-owner-preview',
            });
            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                storage.set({ gain: 0.6 });
                expect(storage.get()).toEqual({ gain: 0.6 });
                expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore + 1);
                expect(captureProjectRevision()).toBe(revision);
                return executeVersionedCommandBatchEnvelope({
                    authority: batch.authority,
                    serialized: batch.serialized,
                });
            });
            try {
                if (transaction.status === 'threw') {
                    throw transaction.error;
                }
                const result = await transaction.value;
                if (result.status === 'previewed') {
                    result.resource.release();
                }
                expect(result.status, JSON.stringify(result)).toBe('rejected');
                expect(JSON.stringify(automergeRepository.getDoc('root'))).toBe(documentBefore);
                expect(captureProjectRevision()).toBe(revision);
                expect(JSON.stringify(actionHistoryStore.value)).toBe(historyBefore);
                expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore + 1);
                expect(storage.get()).toEqual({ gain: 0.6 });
                expect(transportStore.value?.tempo).toBe(100);
                if (terminal === 'commit') {
                    transaction.commit();
                    expect(storage.get()).toEqual({ gain: 0.6 });
                    expect(automergeRepository.getDoc('root')).toMatchObject({ workspaceGain: { gain: 0.6 } });
                    expect(captureProjectRevision()).not.toBe(revision);
                } else {
                    transaction.abort();
                    expect(storage.get()).toEqual({ gain: 1 });
                    expect(JSON.stringify(automergeRepository.getDoc('root'))).toBe(documentBefore);
                    expect(captureProjectRevision()).toBe(revision);
                }
                expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore);
                expect(JSON.stringify(actionHistoryStore.value)).toBe(historyBefore);
            } finally {
                transaction.abort();
            }
        }
    );

    it.each([
        ['root', 'commit'],
        ['root', 'abort'],
        ['notes:buffered', 'commit'],
        ['notes:buffered', 'abort'],
    ] as const)('refuses a workspace over %s pending writes and restores its owner before %s', (docId, terminal) => {
        if (docId !== 'root') {
            automergeRepository.createChildDoc(docId);
        }
        expect(automergeRepository.getDocIds()).toContain(docId);
        const storage = createAutomergeStorage<{ gain: number }>(docId, 'workspaceGain');
        storage.set({ gain: 1 });
        flushAutomergeStorageWrites();
        const revision = captureProjectRevision();
        const documentBefore = JSON.stringify(automergeRepository.getDoc(docId));
        const rootBefore = JSON.stringify(automergeRepository.getDoc('root'));
        const historyBefore = JSON.stringify(actionHistoryStore.value);
        const pendingBefore = countPendingAutomergeStorageWrites();
        const transaction = runWithAutomergeStorageTransaction(undefined, () => {
            storage.set({ gain: 0.6 });
            expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore + 1);
            expect(() => createCommandPreviewWorkspace(revision)).toThrow('Command preview has pending project writes');
            expect(storage.get()).toEqual({ gain: 0.6 });
            expect(JSON.stringify(automergeRepository.getDoc(docId))).toBe(documentBefore);
            expect(JSON.stringify(automergeRepository.getDoc('root'))).toBe(rootBefore);
            expect(captureProjectRevision()).toBe(revision);
            expect(JSON.stringify(actionHistoryStore.value)).toBe(historyBefore);
            storage.set({ gain: 0.4 });
            expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore + 1);
            expect(JSON.stringify(automergeRepository.getDoc(docId))).toBe(documentBefore);
        });
        try {
            if (transaction.status === 'threw') {
                throw transaction.error;
            }
            expect(storage.get()).toEqual({ gain: 0.4 });
            if (terminal === 'commit') {
                transaction.commit();
                expect(storage.get()).toEqual({ gain: 0.4 });
                expect(automergeRepository.getDoc(docId)).toMatchObject({ workspaceGain: { gain: 0.4 } });
                expect(captureProjectRevision()).not.toBe(revision);
            } else {
                transaction.abort();
                expect(storage.get()).toEqual({ gain: 1 });
                expect(JSON.stringify(automergeRepository.getDoc(docId))).toBe(documentBefore);
                expect(captureProjectRevision()).toBe(revision);
            }
            expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore);
            expect(JSON.stringify(actionHistoryStore.value)).toBe(historyBefore);
        } finally {
            transaction.abort();
        }
    });

    it.each(['empty', 'unrelated-document'] as const)(
        'acquires a workspace inside an open owner with %s pending project state',
        (pendingState) => {
            const following = createAutomergeStorage<{ gain: number }>('root', 'postAcquisitionGain');
            following.set({ gain: 1 });
            flushAutomergeStorageWrites();
            const revision = captureProjectRevision();
            const documentBefore = JSON.stringify(automergeRepository.getDoc('root'));
            const pendingBefore = countPendingAutomergeStorageWrites();
            const unrelated = createAutomergeStorage<{ gain: number }>('notes:not-in-project', 'workspaceGain');
            const transaction = runWithAutomergeStorageTransaction(undefined, () => {
                if (pendingState === 'unrelated-document') {
                    unrelated.set({ gain: 0.6 });
                    expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore + 1);
                    expect(automergeRepository.getDocIds()).not.toContain('notes:not-in-project');
                }
                const workspace = createCommandPreviewWorkspace(revision);
                following.set({ gain: 0.4 });
                expect(countPendingAutomergeStorageWrites()).toBe(
                    pendingBefore + (pendingState === 'unrelated-document' ? 2 : 1)
                );
                expect(JSON.stringify(automergeRepository.getDoc('root'))).toBe(documentBefore);
                return workspace;
            });
            try {
                if (transaction.status === 'threw') {
                    throw transaction.error;
                }
                expect(transaction.value.getProjectDocument()).toEqual(JSON.parse(documentBefore));
                transaction.value.release();
                expect(JSON.stringify(automergeRepository.getDoc('root'))).toBe(documentBefore);
                expect(captureProjectRevision()).toBe(revision);
                expect(following.get()).toEqual({ gain: 0.4 });
                if (pendingState === 'unrelated-document') {
                    expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore + 2);
                    expect(unrelated.get()).toEqual({ gain: 0.6 });
                }
            } finally {
                transaction.abort();
            }
            expect(countPendingAutomergeStorageWrites()).toBe(pendingBefore);
            expect(following.get()).toEqual({ gain: 1 });
        }
    );

    it.each([false, true])('previews production tempo without changing live truth after save=%s', async (save) => {
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
        seedSaveCheckpoint();
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

        const checkpointBefore = JSON.stringify(automergeRepository.getDoc('root'));
        if (save) {
            await writeSaveCheckpoint();
            expect(captureProjectRevision()).not.toBe(revision);
            expect(JSON.stringify(automergeRepository.getDoc('root'))).not.toBe(checkpointBefore);
            expect(projectStore.value?.updatedAt).toBe(defaultProjectStoreState.updatedAt + 30_000);
            expect(arrangementStore.value?.arrangements[1]?.tempoMap).toEqual(tempoMapStore.value);
        }
        const savedDocument = JSON.stringify(automergeRepository.getDoc('root'));
        const savedRevision = captureProjectRevision();
        const savedHistory = JSON.stringify(actionHistoryStore.value);
        const notifications = vi.fn();
        const unsubscribe = transportStore.subscribe(notifications);

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
        expect(preview).toMatchObject({ baseRevision: revision, resource: { baseRevision: revision } });
        expect(JSON.stringify(automergeRepository.getDoc('root'))).toBe(savedDocument);
        expect(captureProjectRevision()).toBe(savedRevision);
        expect(JSON.stringify(actionHistoryStore.value)).toBe(savedHistory);
        expect(notifications).not.toHaveBeenCalled();
        unsubscribe();
        expect(transportStore.value?.tempo).toBe(100);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')?.transport).toMatchObject({ tempo: 100 });
        if (preview.status !== 'previewed') {
            throw new Error('Expected a production preview resource');
        }
        const partial = compilePartialCommandBatchAcceptance({
            batchId: 'batch-production-partial',
            previewSelection: preview.partialAcceptance,
            runId: 'run-production-partial',
            selectedIntentGroupIds: [command.commandId],
        });
        expect(partial.status).toBe('compiled');
        if (partial.status !== 'compiled') {
            throw new Error(partial.reason);
        }
        const parsedPartial = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
        expect(parsedPartial).toMatchObject({
            status: 'valid',
            envelope: {
                batchId: 'batch-production-partial',
                mode: 'commit',
                commands: [expect.objectContaining({ operation: 'setTempo' })],
            },
        });
        preview.resource.release();
        preview.resource.release();
        expect(() => preview.workspace.getProjectDocument()).toThrow('Command preview has been released');
        expect(
            compilePartialCommandBatchAcceptance({
                batchId: 'batch-released-preview',
                previewSelection: preview.partialAcceptance,
                runId: 'run-released-preview',
                selectedIntentGroupIds: [command.commandId],
            })
        ).toEqual({
            status: 'rejected',
            reason: 'Partial acceptance requires a successful preview outcome',
        });
    });

    it.each([
        'saved-edit',
        'unflushed',
        'reverted',
        'child-added',
        'child-edited',
        'child-removed',
        'identity',
        'selection',
        'arrangement-name',
        'active-arrangement',
        'inactive-arrangement',
    ])('refuses a %s change at direct workspace acquisition', async (change) => {
        seedSaveCheckpoint();
        const storage = createStore({
            storage: createAutomergeStorage<{ gain: number }>('root', 'workspaceGain'),
            initialData: { gain: 1 },
        });
        storage.set({ gain: 1 });
        flushAutomergeStorageWrites();
        if (change === 'child-edited' || change === 'child-removed') {
            automergeRepository.createChildDoc('notes:changed');
        }
        const revision = captureProjectRevision();
        if (change === 'unflushed') {
            vi.stubGlobal('requestAnimationFrame', () => 0);
            storage.set({ gain: 0.6 });
            expect(storage.value).toEqual({ gain: 0.6 });
            expect(captureProjectRevision()).toBe(revision);
        } else if (change === 'saved-edit') {
            storage.set({ gain: 0.6 });
            await writeSaveCheckpoint();
        } else if (change === 'reverted') {
            storage.set({ gain: 0.6 });
            flushAutomergeStorageWrites();
            storage.set({ gain: 1 });
            flushAutomergeStorageWrites();
        } else if (change === 'child-added') {
            automergeRepository.createChildDoc('notes:changed');
        } else if (change === 'child-edited') {
            automergeRepository.changeDoc('notes:changed', (doc: Record<string, unknown>) => {
                doc.note = 64;
            });
        } else if (change === 'child-removed') {
            automergeRepository.removeDoc('notes:changed');
        } else if (change === 'identity') {
            automergeRepository.createProject('replacement');
        } else {
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                if (change === 'selection') {
                    doc.tracks = { tracks: [], selectedTrackId: 'changed' };
                    return;
                }
                const state = arrangementStore.value;
                if (!state) {
                    throw new Error('Expected arrangements');
                }
                if (change === 'active-arrangement') {
                    doc.arrangements = { ...state, activeArrangementId: 'inactive' };
                    return;
                }
                const changedId = change === 'arrangement-name' ? 'arrangement-save' : 'inactive';
                doc.arrangements = {
                    ...state,
                    arrangements: state.arrangements.map((entry) =>
                        entry.id === changedId ? { ...entry, name: 'Changed name' } : entry
                    ),
                };
            });
        }
        expect(() => createCommandPreviewWorkspace(revision)).toThrow(
            'Command batch base revision does not match current project state'
        );
        if (change === 'unflushed') {
            expect(automergeRepository.getDoc('root')).toMatchObject({ workspaceGain: { gain: 0.6 } });
        }
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
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });
});
