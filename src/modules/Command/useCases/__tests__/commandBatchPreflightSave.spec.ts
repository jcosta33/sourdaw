import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerSupportingServicePorts } from '#/app/registerSupportingServicePorts';
import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    getCurrentAutomergeStorageMutationOwner,
    hasForeignPendingAutomergeStorageWrites,
    runOutsideAutomergeStoragePublisherScope,
    createAutomergeStorage,
    runWithAutomergeStorageTransaction,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import {
    captureProjectMutationAuthorization,
    captureProjectRevision,
    createCrdtDoc,
    getCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    settledProjectRevisionMatchesLiveIgnoringSaveWrites,
    mutateCrdtDoc,
    subscribeToCrdtChanges,
} from '#/modules/CrdtDocument/useCases';
import { arrangementStore, defaultProjectStoreState, projectStore } from '#/modules/Project/stores';
import { buildProjectData } from '#/modules/Project/useCases';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { executeAppActionBatch } from '../executeAppActionBatch';

import { type VersionedCommandBatchEnvelope } from '../../models/VersionedCommandBatchEnvelope';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { prepareCommandBatchPreflight } from '../prepareCommandBatchPreflight';

commandProjectRevisionPort.configureMutationAuthority({
    revisionProvider: captureProjectRevision,
    captureMutationAuthorization: captureProjectMutationAuthorization,
});

describe('command preflight save and content authority', () => {
    afterEach(() => {
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        vi.unstubAllGlobals();
    });

    function revisionEnvelope(revision: string): VersionedCommandBatchEnvelope {
        const command = createExecutionCommandEnvelope({
            action: { type: 'setTrackGain', payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 } },
            expectedEffect: 'Set gain',
            normalizedProjectRevision: revision,
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-save',
            batchId: 'batch-save',
            projectId: 'project-1',
            baseRevision: revision,
            intent: 'Set gain',
            commands: [JSON.stringify(command.envelope)],
        });
        const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
        if (parsed.status !== 'valid') {
            throw new Error(parsed.reason);
        }
        return {
            ...parsed.envelope,
            postconditions: [...parsed.envelope.postconditions, { kind: 'project-revision', value: revision }],
        };
    }

    function validState() {
        return {
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'vocal' },
        };
    }

    function finalValidation(preflight: ReturnType<typeof prepareCommandBatchPreflight>) {
        if (preflight.status !== 'ready') {
            throw new Error(preflight.reason);
        }
        const execution = preflight.prepareExecution();
        if (execution.status !== 'ready') {
            throw new Error(execution.reason);
        }
        const prepared = execution.validation.preparePostconditions();
        if (prepared.status !== 'ready') {
            throw new Error(prepared.reason);
        }
        return prepared.postconditions;
    }

    it('settles before both state captures and supplies only the original exact condition revision', () => {
        let settled = false;
        commandProjectRevisionPort.setProvider(() => 'saved');
        const match = vi.fn(() => {
            settled = true;
            return true;
        });
        commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(match);
        const captures: boolean[] = [];
        commandBatchPreflightPort.setProvider(() => {
            captures.push(settled);
            return validState();
        });
        const envelope = revisionEnvelope('base');
        const prepared = prepareCommandBatchPreflight(envelope);
        expect(prepared.status).toBe('ready');
        if (prepared.status !== 'ready') {
            throw new Error(prepared.reason);
        }
        settled = false;
        const postconditions = finalValidation(prepared);
        expect(match).toHaveBeenCalledTimes(3);
        expect(postconditions.validate({})).toBeNull();
        expect(match).toHaveBeenCalledTimes(3);
        expect(captures).toEqual([true, true]);
        expect(
            prepareCommandBatchPreflight({
                ...envelope,
                preconditions: [...envelope.preconditions, { kind: 'project-revision', value: 'other' }],
            })
        ).toMatchObject({
            status: 'rejected',
            reason: 'Command batch base revision does not match current project state',
        });
        const wrongPost = prepareCommandBatchPreflight({
            ...envelope,
            postconditions: [...envelope.postconditions, { kind: 'project-revision', value: 'other' }],
        });
        if (wrongPost.status !== 'ready') {
            throw new Error(wrongPost.reason);
        }
        expect(finalValidation(wrongPost).validate({})).toBe(
            'Command batch base revision does not match current project state'
        );
    });

    it('rechecks actual save and pending content edits after preparation without caching permission', async () => {
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        try {
            projectStore.set(structuredClone(defaultProjectStoreState));
            arrangementStore.set({
                activeArrangementId: 'save',
                arrangements: [
                    {
                        id: 'save',
                        name: 'Save',
                        tracks: { tracks: [], selectedTrackId: null },
                        automation: { lanes: [] },
                        midi: { notesByClipId: {}, ccByClipId: {}, pitchBendByClipId: {} },
                    },
                ],
            });
            flushAutomergeStorageWrites();
            const revision = captureProjectRevision();
            commandProjectRevisionPort.setProvider(captureProjectRevision);
            commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(
                settledProjectRevisionMatchesLiveIgnoringSaveWrites
            );
            commandBatchPreflightPort.setProvider(validState);
            const envelope = revisionEnvelope(revision);
            const prepared = prepareCommandBatchPreflight(envelope);
            if (prepared.status !== 'ready') {
                throw new Error(prepared.reason);
            }
            const project = projectStore.value;
            if (!project) {
                throw new Error('Expected project');
            }
            projectStore.set({ ...project, updatedAt: project.updatedAt + 30_000 });
            registerSupportingServicePorts();
            await buildProjectData({ includeAudioBuffers: false });
            flushAutomergeStorageWrites();
            expect(captureProjectRevision()).not.toBe(revision);
            expect(prepareCommandBatchPreflight(envelope).status).toBe('ready');
            const savedDocument = getCrdtDoc('root');
            if (!savedDocument) {
                throw new Error('Expected saved root');
            }
            const execution = prepared.prepareExecution();
            if (execution.status !== 'ready') {
                throw new Error(execution.reason);
            }
            const postconditions = execution.validation.preparePostconditions();
            if (postconditions.status !== 'ready') {
                throw new Error(postconditions.reason);
            }
            expect(postconditions.postconditions.validate(savedDocument)).toBeNull();
            vi.stubGlobal('requestAnimationFrame', () => 0);
            const savedProject = projectStore.value;
            if (!savedProject) {
                throw new Error('Expected saved project');
            }
            projectStore.set({ ...savedProject, name: 'Edited project' });
            expect(prepared.prepareExecution()).toEqual({
                status: 'rejected',
                reason: 'Command batch base revision does not match current project state',
            });
            expect(execution.validation.preparePostconditions()).toEqual({
                status: 'rejected',
                reason: 'Command batch project changed after execution source preparation',
            });
            expect(prepareCommandBatchPreflight(envelope).status).toBe('rejected');
            const compatible = prepareCommandBatchPreflight(envelope, { allowCompatibleProjectDivergence: true });
            expect(compatible.status).toBe('ready');
            if (compatible.status !== 'ready') {
                throw new Error(compatible.reason);
            }
            expect(finalValidation(compatible).validate({})).toBe(
                'Command batch base revision does not match current project state'
            );
        } finally {
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
        }
    });
    it.each(['before capture', 'during capture'] as const)(
        'fences published changes %s without another historical read',
        (phase) => {
            let revision = 'saved';
            commandProjectRevisionPort.setProvider(() => revision);
            const match = vi.fn(() => true);
            commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(match);
            commandBatchPreflightPort.setProvider(({ projectDocument }) => {
                if (projectDocument && phase === 'during capture') {
                    revision = 'changed';
                }
                return validState();
            });
            const postconditions = finalValidation(prepareCommandBatchPreflight(revisionEnvelope('base')));
            match.mockClear();
            if (phase === 'before capture') {
                revision = 'changed';
            }
            expect(postconditions.validate({})).toBe(
                'Command batch project changed after execution source preparation'
            );
            expect(match).not.toHaveBeenCalled();
        }
    );

    it.each([false, true])(
        'leaves owned writes pending through final preparation and preserves candidate refusal=%s',
        (refuse) => {
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            createCrdtDoc('root');
            registerCrdtStorageRuntime();
            const gain = createAutomergeStorage<{ value: number }>('root', 'ownedGain');
            gain.set({ value: 1 });
            flushAutomergeStorageWrites();
            const revision = captureProjectRevision();
            commandProjectRevisionPort.setProvider(captureProjectRevision);
            const match = vi.fn(settledProjectRevisionMatchesLiveIgnoringSaveWrites);
            commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(match);
            commandBatchPreflightPort.setProvider(({ projectDocument }) => ({
                ...validState(),
                projectInvariantsValid: !projectDocument || !refuse,
            }));
            const preflight = prepareCommandBatchPreflight(revisionEnvelope(revision));
            const transaction = runWithAutomergeStorageTransaction(undefined, (scope) =>
                scope(() => {
                    if (preflight.status !== 'ready') {
                        throw new Error(preflight.reason);
                    }
                    const execution = preflight.prepareExecution();
                    if (execution.status !== 'ready') {
                        throw new Error(execution.reason);
                    }
                    gain.set({ value: 0.8 });
                    return execution.validation;
                })
            );
            try {
                if (transaction.status === 'threw') {
                    throw transaction.error;
                }
                const preparedPostconditions = transaction.scope(() => transaction.value.preparePostconditions());
                if (preparedPostconditions.status !== 'ready') {
                    throw new Error(preparedPostconditions.reason);
                }
                const postconditions = preparedPostconditions.postconditions;
                expect(getCrdtDoc('root')?.ownedGain).toEqual({ value: 1 });
                expect(gain.get()).toEqual({ value: 0.8 });
                match.mockClear();
                transaction.validateDocument(postconditions.documentId, postconditions.validate);
                if (refuse) {
                    expect(() => transaction.commit()).toThrow('Command batch violated project invariants');
                    transaction.abort();
                    expect(getCrdtDoc('root')?.ownedGain).toEqual({ value: 1 });
                    expect(gain.get()).toEqual({ value: 1 });
                } else {
                    transaction.commit();
                    expect(getCrdtDoc('root')?.ownedGain).toEqual({ value: 0.8 });
                    expect(gain.get()).toEqual({ value: 0.8 });
                }
                expect(match).not.toHaveBeenCalled();
            } finally {
                transaction.abort();
                configureAutomergeStoragePort(null);
                removeCrdtDoc('root');
            }
        }
    );
    it.each([false, true])(
        'admits an owned child publication before the root and detects a foreign notification=%s',
        async (foreign) => {
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            removeCrdtDoc('owned');
            createCrdtDoc('root');
            createCrdtDoc('owned');
            registerCrdtStorageRuntime();
            const rootGain = createAutomergeStorage<{ value: number }>('root', 'ownedGain');
            const childGain = createAutomergeStorage<{ value: number }>('owned', 'ownedGain');
            rootGain.set({ value: 1 });
            childGain.set({ value: 1 });
            flushAutomergeStorageWrites();
            const revision = captureProjectRevision();
            commandProjectRevisionPort.setProvider(captureProjectRevision);
            const match = vi.fn(settledProjectRevisionMatchesLiveIgnoringSaveWrites);
            commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(match);
            commandBatchPreflightPort.setProvider(validState);
            clearHandlerRegistry();
            registerHandlerMap({
                setTrackGain: {
                    execute: () => {
                        childGain.set({ value: 0.8 });
                        rootGain.set({ value: 0.8 });
                    },
                    describe: () => ({ label: 'Set gain' }),
                    undoable: false,
                    requiresAbortCompensation: false,
                    validate: () => true,
                },
            });
            let sawOwnedPublication = false;
            const unsubscribe = subscribeToCrdtChanges((docId) => {
                if (docId !== 'owned' || sawOwnedPublication) {
                    return;
                }
                sawOwnedPublication = true;
                // A historical matcher in the later candidate must fail even without a save.
                match.mockImplementation(() => {
                    throw new Error('Historical matcher reached an open candidate');
                });
                if (foreign) {
                    mutateCrdtDoc<Record<string, unknown>>({
                        id: 'root',
                        changeFn: (draft) => {
                            draft.peer = true;
                        },
                    });
                }
            });
            try {
                const result = await executeAppActionBatch(
                    [{ type: 'setTrackGain', payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 } }],
                    { prepareValidation: () => prepareCommandBatchPreflight(revisionEnvelope(revision)) }
                );
                expect(sawOwnedPublication).toBe(true);
                expect(getCrdtDoc('owned')?.ownedGain).toEqual({ value: 0.8 });
                if (foreign) {
                    expect(result).toMatchObject({
                        status: 'ambiguous',
                        reason: 'Automerge storage transaction committed before a later document failed',
                    });
                    expect(getCrdtDoc('root')).toMatchObject({ ownedGain: { value: 1 }, peer: true });
                } else {
                    expect(result.status).toBe('committed');
                    expect(getCrdtDoc('root')?.ownedGain).toEqual({ value: 0.8 });
                }
            } finally {
                unsubscribe();
                configureAutomergeStoragePort(null);
                removeCrdtDoc('owned');
                removeCrdtDoc('root');
            }
        }
    );

    it.each([
        { document: 'root', phase: 'before capture' },
        { document: 'peer-child', phase: 'before capture' },
        { document: 'root', phase: 'during capture' },
    ] as const)(
        'refuses a foreign unflushed $document edit queued $phase after an owned publication',
        async ({ document, phase }) => {
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            removeCrdtDoc('owned');
            removeCrdtDoc('peer-child');
            createCrdtDoc('root');
            createCrdtDoc('owned');
            createCrdtDoc('peer-child');
            registerCrdtStorageRuntime();
            projectStore.set({ ...structuredClone(defaultProjectStoreState), name: 'Before listener' });
            const peer = createAutomergeStorage<{ name: string }>('peer-child', 'peerMeta');
            const rootGain = createAutomergeStorage<{ value: number }>('root', 'ownedGain');
            const childGain = createAutomergeStorage<{ value: number }>('owned', 'ownedGain');
            peer.set({ name: 'Before listener' });
            rootGain.set({ value: 1 });
            childGain.set({ value: 1 });
            flushAutomergeStorageWrites();
            const readVisibleName = () => (document === 'root' ? projectStore.value?.name : peer.get()?.name);
            function readRawName(): unknown {
                const value = getCrdtDoc(document)?.[document === 'root' ? 'projectMeta' : 'peerMeta'];
                return value !== null && typeof value === 'object' && 'name' in value ? value.name : undefined;
            }
            vi.stubGlobal(
                'requestAnimationFrame',
                vi.fn(() => 0)
            );
            vi.stubGlobal('cancelAnimationFrame', vi.fn());
            const revision = captureProjectRevision();
            commandProjectRevisionPort.setProvider(captureProjectRevision);
            commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(
                settledProjectRevisionMatchesLiveIgnoringSaveWrites
            );
            let sawOwnedPublication = false;
            let queued = false;
            let ownerWasForeign = false;
            let revisionStayedUnchanged = false;
            let pendingBefore = 0;
            let pendingAfter = 0;
            let rawNameWhenQueued: unknown;
            let visibleNameWhenQueued: unknown;
            function queueForeignEdit(): void {
                runOutsideAutomergeStoragePublisherScope(() => {
                    const before = captureProjectRevision();
                    pendingBefore = countPendingAutomergeStorageWrites();
                    ownerWasForeign = getCurrentAutomergeStorageMutationOwner() === undefined;
                    if (document === 'root') {
                        const project = projectStore.value;
                        if (!project) {
                            throw new Error('Expected visible project metadata');
                        }
                        projectStore.set({ ...project, name: 'Foreign visible edit' });
                    } else {
                        peer.set({ name: 'Foreign visible edit' });
                    }
                    queued = true;
                    pendingAfter = countPendingAutomergeStorageWrites();
                    revisionStayedUnchanged = captureProjectRevision() === before;
                    rawNameWhenQueued = readRawName();
                    visibleNameWhenQueued = readVisibleName();
                });
            }
            commandBatchPreflightPort.setProvider(({ projectDocument }) => {
                if (projectDocument && phase === 'during capture' && !queued) {
                    expect(sawOwnedPublication).toBe(true);
                    queueForeignEdit();
                }
                return validState();
            });
            clearHandlerRegistry();
            registerHandlerMap({
                setTrackGain: {
                    execute: () => {
                        childGain.set({ value: 0.8 });
                        rootGain.set({ value: 0.8 });
                    },
                    describe: () => ({ label: 'Set gain' }),
                    undoable: false,
                    requiresAbortCompensation: false,
                    validate: () => true,
                },
            });
            const unsubscribe = subscribeToCrdtChanges((docId) => {
                if (docId !== 'owned' || sawOwnedPublication) {
                    return;
                }
                sawOwnedPublication = true;
                if (phase === 'before capture') {
                    queueForeignEdit();
                }
            });
            try {
                const result = await executeAppActionBatch(
                    [{ type: 'setTrackGain', payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 } }],
                    { prepareValidation: () => prepareCommandBatchPreflight(revisionEnvelope(revision)) }
                );
                expect(sawOwnedPublication).toBe(true);
                expect(queued).toBe(true);
                expect(ownerWasForeign).toBe(true);
                expect(revisionStayedUnchanged).toBe(true);
                expect(pendingAfter).toBe(pendingBefore + 1);
                expect(rawNameWhenQueued).toBe('Before listener');
                expect(visibleNameWhenQueued).toBe('Foreign visible edit');
                expect(hasForeignPendingAutomergeStorageWrites(document)).toBe(true);
                expect.soft(result).toMatchObject({
                    status: 'ambiguous',
                    reason: 'Automerge storage transaction committed before a later document failed',
                });
                expect.soft(getCrdtDoc('root')?.ownedGain).toEqual({ value: 1 });
                expect(getCrdtDoc('owned')?.ownedGain).toEqual({ value: 0.8 });
                expect(readRawName()).toBe('Before listener');
                expect(readVisibleName()).toBe('Foreign visible edit');
                flushAutomergeStorageWrites();
                expect(readRawName()).toBe('Foreign visible edit');
                expect(getCrdtDoc('owned')?.ownedGain).toEqual({ value: 0.8 });
                expect.soft(getCrdtDoc('root')?.ownedGain).toEqual({ value: 1 });
            } finally {
                unsubscribe();
                configureAutomergeStoragePort(null);
                removeCrdtDoc('owned');
                removeCrdtDoc('peer-child');
                removeCrdtDoc('root');
            }
        }
    );

    it.each([false, true])(
        'normalizes an owned published prefix without granting the original base to compatible foreign content=%s',
        (compatible) => {
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            createCrdtDoc('root');
            registerCrdtStorageRuntime();
            commandProjectRevisionPort.setProvider(captureProjectRevision);
            commandProjectRevisionPort.setLiveMatchIgnoringSaveWrites(
                settledProjectRevisionMatchesLiveIgnoringSaveWrites
            );
            commandBatchPreflightPort.setProvider(validState);
            const base = captureProjectRevision();
            if (compatible) {
                mutateCrdtDoc<Record<string, unknown>>({
                    id: 'root',
                    changeFn: (draft) => {
                        draft.peer = true;
                    },
                });
            }
            const preflight = prepareCommandBatchPreflight(revisionEnvelope(base), {
                allowCompatibleProjectDivergence: compatible,
            });
            const transaction = runWithAutomergeStorageTransaction(undefined, (scope) =>
                scope(() => {
                    if (preflight.status !== 'ready') {
                        throw new Error(preflight.reason);
                    }
                    const execution = preflight.prepareExecution();
                    if (execution.status !== 'ready') {
                        throw new Error(execution.reason);
                    }
                    mutateCrdtDoc<Record<string, unknown>>({
                        id: 'root',
                        changeFn: (draft) => {
                            draft.owned = true;
                        },
                    });
                    const prepared = execution.validation.preparePostconditions();
                    if (prepared.status !== 'ready') {
                        throw new Error(prepared.reason);
                    }
                    const document = getCrdtDoc('root');
                    if (!document) {
                        throw new Error('Expected root');
                    }
                    expect(prepared.postconditions.validate(document)).toBe(
                        compatible ? 'Command batch base revision does not match current project state' : null
                    );
                })
            );
            transaction.commit();
            expect(transaction.status).toBe('returned');
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
        }
    );
});
