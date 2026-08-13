import { afterEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort, createAutomergeStorage } from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';

import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandDeviceVersionsPort } from '../commandDeviceVersionsPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';

function applyTransactionalMutation(
    document: Record<string, unknown>,
    changeFn: (draft: Record<string, unknown>) => void
): void {
    const draft = structuredClone(document);
    changeFn(draft);
    for (const key of Object.keys(document)) {
        delete document[key];
    }
    Object.assign(document, draft);
}

describe('command batch preflight', () => {
    afterEach(() => {
        clearHandlerRegistry();
        configureAutomergeStoragePort(null);
        commandBatchPreflightPort.setProvider(null);
        commandDeviceVersionsPort.setDeviceTypeResolver(null);
        commandDeviceVersionsPort.setResolver(null);
        commandProjectRevisionPort.setProvider(null);
        vi.unstubAllGlobals();
    });

    it('rejects missing targets before the first handler effect', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-missing-target',
            batchId: 'batch-missing-target',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch target does not exist: track-vocal',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('aborts staged writes when a postcondition fails before commit', async () => {
        let stagedGain = 1;
        let captureCount = 0;
        const execute = vi.fn(() => {
            stagedGain = 0.8;
            return { status: 'written' as const };
        });
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => {
            captureCount += 1;
            return {
                audioGraphValid: captureCount === 1,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-1',
                projectInvariantsValid: true,
                targetFingerprints: { 'track-vocal': JSON.stringify({ gain: stagedGain }) },
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-invalid-graph',
            batchId: 'batch-invalid-graph',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: 'Command batch produced an invalid audio graph',
            actions: [],
        });
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it('aborts staged writes when authoritative postcondition capture throws', async () => {
        let captureCount = 0;
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => {
            captureCount += 1;
            if (captureCount > 1) {
                throw new Error('capture failed');
            }
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-1',
                projectInvariantsValid: true,
                targetFingerprints: { 'track-vocal': 'vocal' },
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-capture-throw',
            batchId: 'batch-capture-throw',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'conflicted',
            reason: 'Command batch postcondition validation failed: capture failed',
            actions: [],
        });
        expect(execute).toHaveBeenCalledTimes(2);
    });

    it('rejects unavailable imported assets before dispatch', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            addClip: {
                execute,
                describe: () => ({
                    label: 'Add clip',
                    inverseAction: {
                        type: 'removeClip',
                        payload: { clipId: 'clip-1' },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-1': JSON.stringify({ id: 'track-1' }) },
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addClip',
                payload: {
                    id: 'clip-1',
                    trackId: 'track-1',
                    startBeat: 0,
                    endBeat: 4,
                    name: 'Missing asset',
                    type: 'audio',
                    audioBufferId: 'buffer-missing',
                    assetHash: 'sha256:missing',
                },
            },
            expectedEffect: 'Add clip',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-missing-asset',
            batchId: 'batch-missing-asset',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add audio clip',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch asset is unavailable: buffer-missing',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('requires application-assigned created targets to be absent before and present after execution', async () => {
        let captureCount = 0;
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            addClip: {
                execute,
                describe: () => ({
                    label: 'Add clip',
                    inverseAction: {
                        type: 'removeClip',
                        payload: { clipId: 'clip-1' },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => {
            captureCount += 1;
            const targetFingerprints: Record<string, string> = { 'track-1': 'track' };
            if (captureCount > 1) {
                targetFingerprints['clip-1'] = 'clip';
            }
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-1',
                projectInvariantsValid: true,
                targetFingerprints,
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addClip',
                payload: { id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Verse' },
            },
            expectedEffect: 'Add clip',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-create',
            batchId: 'batch-create',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add clip',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({ status: 'committed', actions: [{ action: { type: 'addClip' } }] });
        expect(execute).toHaveBeenCalledTimes(1);
    });

    it('rejects overlap with an authoritative locked range before dispatch', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            addSection: {
                execute,
                describe: () => ({
                    label: 'Add section',
                    inverseAction: {
                        type: 'removeSection',
                        payload: { sectionId: 'section-1' },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [{ startBeat: 8, endBeat: 16 }],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: {},
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addSection',
                payload: { sectionId: 'section-1', startBeat: 12, endBeat: 20, name: 'Chorus' },
            },
            expectedEffect: 'Add section',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-locked-range',
            batchId: 'batch-locked-range',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add chorus',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch target range is locked',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('captures authoritative preflight state after the snapshot gate settles', async () => {
        let releaseSnapshot!: () => void;
        const snapshotSettled = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        const doc: Record<string, unknown> = {};
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => applyTransactionalMutation(doc, changeFn),
            waitForSnapshotTransaction: () => snapshotSettled,
        });
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        let targetExists = true;
        const capture = vi.fn(() => {
            const targetFingerprints: Record<string, string> = targetExists ? { 'track-vocal': 'vocal' } : {};
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-1',
                projectInvariantsValid: true,
                targetFingerprints,
            };
        });
        commandBatchPreflightPort.setProvider(capture);
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-snapshot-race',
            batchId: 'batch-snapshot-race',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });
        const execution = executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
            options: { snapshotTransaction: {} },
        });

        expect(capture).not.toHaveBeenCalled();
        targetExists = false;
        releaseSnapshot();

        await expect(execution).resolves.toEqual({
            status: 'rejected',
            reason: 'Command batch target does not exist: track-vocal',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('revalidates device versions after the snapshot gate settles', async () => {
        let releaseSnapshot!: () => void;
        const snapshotSettled = new Promise<void>((resolve) => {
            releaseSnapshot = resolve;
        });
        const doc: Record<string, unknown> = {};
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => applyTransactionalMutation(doc, changeFn),
            waitForSnapshotTransaction: () => snapshotSettled,
        });
        let deviceVersion = 'compressor-v1';
        commandDeviceVersionsPort.setDeviceTypeResolver(() => ({}));
        commandDeviceVersionsPort.setResolver(() => deviceVersion);
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            addDevice: {
                execute,
                describe: () => ({
                    label: 'Add compressor',
                    inverseAction: {
                        type: 'removeDevice',
                        payload: { trackId: 'track-vocal', deviceId: 'device-compressor' },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'vocal' },
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addDevice',
                payload: {
                    trackId: 'track-vocal',
                    deviceId: 'device-compressor',
                    deviceType: 'builtin-compressor',
                },
            },
            expectedEffect: 'Add compressor',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-device-version-race',
            batchId: 'batch-device-version-race',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add compressor',
            commands: [JSON.stringify(command.envelope)],
        });
        const execution = executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
            options: { snapshotTransaction: {} },
        });

        deviceVersion = 'compressor-v2';
        releaseSnapshot();

        await expect(execution).resolves.toMatchObject({
            status: 'conflicted',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('validates created targets against the staged root document before commit', async () => {
        type TestTrackState = { tracks: { clips: { id: string }[]; id: string }[] };
        const doc: Record<string, unknown> = {
            tracks: { tracks: [{ clips: [], id: 'track-1' }] },
        };
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => applyTransactionalMutation(doc, changeFn),
        });
        const storage = createAutomergeStorage<TestTrackState>('root', 'tracks');
        storage.hydrate?.();
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const execute = vi.fn(() => {
            storage.set({ tracks: [{ clips: [{ id: 'clip-1' }], id: 'track-1' }] });
            return { status: 'written' as const };
        });
        registerHandlerMap({
            addClip: {
                execute,
                describe: () => ({
                    label: 'Add clip',
                    inverseAction: { type: 'removeClip', payload: { clipId: 'clip-1' } },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider((input) => {
            const suppliedDocument = 'projectDocument' in input ? input.projectDocument : undefined;
            const authoritativeDocument = suppliedDocument ?? doc;
            const serializedDocument = JSON.stringify(authoritativeDocument);
            const targetFingerprints = Object.fromEntries(
                input.targetIds.flatMap((targetId) =>
                    serializedDocument.includes(`"id":"${targetId}"`) ? [[targetId, targetId]] : []
                )
            );
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-1',
                projectInvariantsValid: true,
                targetFingerprints,
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'addClip',
                payload: { id: 'clip-1', trackId: 'track-1', startBeat: 0, endBeat: 4, name: 'Verse' },
            },
            expectedEffect: 'Add clip',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-staged-create',
            batchId: 'batch-staged-create',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Add clip',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({ status: 'committed', actions: [{ action: { type: 'addClip' } }] });
        expect(doc).toMatchObject({ tracks: { tracks: [{ clips: [{ id: 'clip-1' }] }] } });
    });

    it('rejects a staged protected-target mutation before the root document commits', async () => {
        type TestTrackState = { tracks: { gain: number; id: string }[] };
        const doc: Record<string, unknown> = {
            tracks: {
                tracks: [
                    { gain: 1, id: 'track-vocal' },
                    { gain: 1, id: 'track-protected' },
                ],
            },
        };
        configureAutomergeStoragePort({
            getDoc: () => doc,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => applyTransactionalMutation(doc, changeFn),
        });
        const storage = createAutomergeStorage<TestTrackState>('root', 'tracks');
        storage.hydrate?.();
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal('cancelAnimationFrame', vi.fn());
        const execute = vi.fn(() => {
            storage.set({
                tracks: [
                    { gain: 0.8, id: 'track-vocal' },
                    { gain: 0.5, id: 'track-protected' },
                ],
            });
            return { status: 'written' as const };
        });
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider((input) => {
            const suppliedDocument = 'projectDocument' in input ? input.projectDocument : undefined;
            const authoritativeDocument = suppliedDocument ?? doc;
            const tracksSlot = (authoritativeDocument as { tracks?: TestTrackState }).tracks;
            const targetFingerprints = Object.fromEntries(
                input.targetIds.flatMap((targetId) => {
                    const target = tracksSlot?.tracks.find((track) => track.id === targetId);
                    return target ? [[targetId, JSON.stringify(target)]] : [];
                })
            );
            return {
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-1',
                projectInvariantsValid: true,
                targetFingerprints,
            };
        });
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-protected-mutation',
            batchId: 'batch-protected-mutation',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
            protectedTargetIds: ['track-protected'],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toMatchObject({
            status: 'conflicted',
            reason: 'Command batch changed protected target: track-protected',
            actions: [],
        });
        expect(doc).toMatchObject({
            tracks: {
                tracks: [
                    { gain: 1, id: 'track-vocal' },
                    { gain: 1, id: 'track-protected' },
                ],
            },
        });
    });

    it('rejects a batch bound to a different active project before dispatch', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-other',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'vocal' },
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-project-mismatch',
            batchId: 'batch-project-mismatch',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch project does not match the active project',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects oversized serialized batches before JSON parsing or dispatch', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({ label: 'Set gain', inverseAction: null }),
                undoable: false,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-1',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'fingerprint' },
        }));
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-oversized',
            batchId: 'batch-oversized',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: `${compiled.serialized}${' '.repeat(1_048_576)}`,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch exceeds the serialized payload limit',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });

    it('rejects before dispatch when authoritative preflight state is unavailable', async () => {
        const execute = vi.fn(() => ({ status: 'written' as const }));
        registerHandlerMap({
            setTrackGain: {
                execute,
                describe: () => ({
                    label: 'Set gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                undoable: true,
            },
        });
        commandProjectRevisionPort.setProvider(() => 'revision-1');
        const command = createExecutionCommandEnvelope({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            expectedEffect: 'Set vocal gain',
            normalizedProjectRevision: 'revision-1',
        });
        const compiled = compileVersionedCommandBatchEnvelope({
            runId: 'run-preflight',
            batchId: 'batch-preflight',
            projectId: 'project-1',
            baseRevision: 'revision-1',
            intent: 'Set vocal gain',
            commands: [JSON.stringify(command.envelope)],
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: compiled.authority,
            confirmed: true,
            serialized: compiled.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Command batch preflight state is unavailable',
            actions: [],
        });
        expect(execute).not.toHaveBeenCalled();
    });
});
