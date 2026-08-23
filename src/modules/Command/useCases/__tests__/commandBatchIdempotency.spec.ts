import { from } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { commandBatchExecutionAuthorityPort } from '../commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from '../commandBatchIdempotencyPort';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandBatchPreviewPort } from '../commandBatchPreviewPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { commandRuntimeRepairPort } from '../commandRuntimeRepairPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { configureCommandBatchIdempotency } from '../configureCommandBatchIdempotency';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { getCommandBatchContentHash } from '../getCommandBatchContentHash';
import { getVersionedCommandBatchIdempotentReplay } from '../getVersionedCommandBatchIdempotentReplay';
import { persistProjectCommandBatchIdempotencyCheckpoint } from '../persistProjectCommandBatchIdempotencyCheckpoint';

import { executeApprovedVersionedCommandBatchEnvelope as executeVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;
type SetTrackPanAction = Extract<AppAction, { type: 'setTrackPan' }>;

const mocks = vi.hoisted(() => ({
    clearSemanticContext: vi.fn(),
    commitUndoEntry: vi.fn(),
    recordAction: vi.fn(),
    recordActionHistoryMetadata: vi.fn(() => []),
    setSemanticContext: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: { value: null },
    clearSemanticContext: mocks.clearSemanticContext,
    setSemanticContext: mocks.setSemanticContext,
}));
vi.mock('../actionHistoryMetadataPort', () => ({
    actionHistoryMetadataPort: { record: mocks.recordActionHistoryMetadata },
}));
vi.mock('../commitUndoEntry', () => ({ commitUndoEntry: mocks.commitUndoEntry }));
vi.mock('../macro/recording/recordAction', () => ({ recordAction: mocks.recordAction }));

function revision(head: number): string {
    return JSON.stringify({
        documentIdentityEpoch: 1,
        mutationEpoch: head,
        documents: [{ docId: 'root', heads: [`head-${String(head)}`] }],
    });
}

function createHandler(input: {
    execute: Extract<ActionHandler<SetTrackGainAction>, { previewExecution: 'isolated-project' }>['execute'];
}): ActionHandler<SetTrackGainAction> {
    return {
        canReapplyAfterDivergence: () => true,
        describe: () => ({
            inverseAction: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
            },
            label: 'Set vocal gain',
        }),
        execute: input.execute,
        previewExecution: 'isolated-project',
        undoable: true,
        validate: () => true,
    };
}

function compileBatch(
    input: {
        baseRevision?: string;
        batchId?: string;
        expectedGain?: number;
        gain?: number;
        runId?: string;
    } = {}
) {
    const baseRevision = input.baseRevision ?? revision(0);
    const gain = input.gain ?? 0.8;
    const action: SetTrackGainAction = {
        type: 'setTrackGain',
        payload: { trackId: 'track-vocal', gain, expectedGain: input.expectedGain ?? 1 },
    };
    const command = {
        ...createExecutionCommandEnvelope({
            action,
            expectedEffect: 'Set the vocal gain to 0.8.',
            normalizedProjectRevision: baseRevision,
        }).envelope,
        commandId: '11111111-1111-4111-8111-111111111111',
    };
    return compileVersionedCommandBatchEnvelope({
        baseRevision,
        batchId: input.batchId ?? 'batch-idempotency',
        commands: [JSON.stringify(command)],
        idempotencyKey: 'client-request-1',
        intent: 'Set vocal gain',
        mode: 'commit',
        projectId: 'project-idempotency',
        runId: input.runId ?? 'run-idempotency',
    });
}

describe('command batch idempotency', () => {
    const durableStorageKey = 'sourdaw:command-batch-idempotency:v1';
    let mutationCount: number;
    let projectDocument: Record<string, unknown>;
    let rejectProjectReceiptFinalization: boolean;
    let rejectReceiptPersistence: boolean;
    let runtimeEffectGate: Promise<void> | null;
    let runtimeEffectCount: number;
    let runtimeGain: number;

    beforeEach(() => {
        vi.clearAllMocks();
        vi.stubGlobal('navigator', {
            ...navigator,
            locks: {
                request: (_name: string, _options: LockOptions, task: () => unknown) => Promise.resolve(task()),
            },
        });
        localStorage.removeItem(durableStorageKey);
        commandBatchExecutionAuthorityPort.setProvider(() => true);
        clearHandlerRegistry();
        mutationCount = 0;
        rejectProjectReceiptFinalization = false;
        rejectReceiptPersistence = false;
        runtimeEffectGate = null;
        runtimeEffectCount = 0;
        runtimeGain = 1;
        projectDocument = { trackGain: { value: 1 }, trackPan: { value: 0 } };
        const baseProjectDocument = structuredClone(projectDocument);
        const records = new Map<string, { contentHash: string; serializedReceipt?: string }>();
        commandBatchIdempotencyPort.setRepository({
            lookup: ({ projectId, idempotencyKey, contentHash }) => {
                const existing = records.get(`${projectId}:${idempotencyKey}`);
                if (!existing) {
                    return Promise.resolve({ status: 'missing' });
                }
                if (existing.contentHash !== contentHash) {
                    return Promise.resolve({ status: 'conflict' });
                }
                if (existing.serializedReceipt) {
                    return Promise.resolve({ status: 'complete', serializedReceipt: existing.serializedReceipt });
                }
                return Promise.resolve({ status: 'pending' });
            },
            claim: ({ projectId, idempotencyKey, contentHash }) => {
                const key = `${projectId}:${idempotencyKey}`;
                const existing = records.get(key);
                if (!existing) {
                    records.set(key, { contentHash });
                    return Promise.resolve({ status: 'claimed' });
                }
                if (existing.contentHash !== contentHash) {
                    return Promise.resolve({ status: 'conflict' });
                }
                if (existing.serializedReceipt) {
                    return Promise.resolve({ status: 'complete', serializedReceipt: existing.serializedReceipt });
                }
                return Promise.resolve({ status: 'pending' });
            },
            complete: ({ projectId, idempotencyKey, contentHash, serializedReceipt }) => {
                if (rejectReceiptPersistence) {
                    return Promise.reject(new Error('durable store unavailable'));
                }
                records.set(`${projectId}:${idempotencyKey}`, { contentHash, serializedReceipt });
                return Promise.resolve();
            },
        });
        configureAutomergeStoragePort({
            getDoc: () => projectDocument,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                if (rejectProjectReceiptFinalization && mutationCount === 1) {
                    throw new Error('project receipt finalization unavailable');
                }
                const draft = structuredClone(projectDocument);
                changeFn(draft);
                projectDocument = draft;
                mutationCount += 1;
            },
        });
        commandBatchPreviewPort.setProvider(() => {
            const preview = createAutomergeStoragePreview(new Map([['root', from(projectDocument)]]));
            return {
                getProjectDocument: () => preview.getDocument('root') ?? {},
                release: preview.release,
                scope: preview.scope,
            };
        });
        commandBatchPreviewPort.setRecoveryProvider(() => {
            const preview = createAutomergeStoragePreview(new Map([['root', from(baseProjectDocument)]]));
            return {
                getProjectDocument: () => preview.getDocument('root') ?? {},
                release: preview.release,
                scope: preview.scope,
            };
        });
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    async function applyRuntimeEffect() {
                        await runtimeEffectGate;
                        if (runtimeGain === 0.8) {
                            return;
                        }
                        runtimeGain = 0.8;
                        runtimeEffectCount += 1;
                    }
                    return {
                        status: 'written',
                        afterCommit: applyRuntimeEffect,
                        afterAmbiguousCommit: applyRuntimeEffect,
                    };
                },
            }),
        });
        commandProjectRevisionPort.setProvider(() => revision(mutationCount));
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-idempotency',
            projectInvariantsValid: true,
            targetFingerprints: { 'track-vocal': 'track:track-vocal' },
        }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        commandBatchPreflightPort.setProvider(null);
        commandBatchPreviewPort.setProvider(null);
        commandBatchPreviewPort.setRecoveryProvider(null);
        commandBatchIdempotencyPort.setRepository(null);
        commandBatchExecutionAuthorityPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        commandRuntimeRepairPort.setProvider(null);
        localStorage.removeItem(durableStorageKey);
        clearHandlerRegistry();
    });

    it('rejects a collaboration joiner before project or runtime effects', async () => {
        commandBatchExecutionAuthorityPort.setProvider(() => false);
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Only the authoritative collaboration host can execute a durable command batch',
        });
        expect(mutationCount).toBe(0);
        expect(runtimeEffectCount).toBe(0);
    });

    it('returns the prior verified receipt for an exact retry without repeating project or runtime effects', async () => {
        const batch = compileBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(first.status).toBe('committed');
        expect(retry).toEqual({
            status: 'idempotent-replay',
            actions: [],
            receipt: 'receipt' in first ? first.receipt : undefined,
        });
        expect(projectDocument).toMatchObject({ trackGain: { value: 0.8 } });
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
    });

    it('returns the prior receipt after the durable repository is recreated', async () => {
        commandBatchIdempotencyPort.setRepository(null);
        configureCommandBatchIdempotency({ canExecute: () => true });
        const batch = compileBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        commandBatchIdempotencyPort.setRepository(null);
        configureCommandBatchIdempotency({ canExecute: () => true });
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(first.status).toBe('committed');
        expect(retry).toEqual({
            status: 'idempotent-replay',
            actions: [],
            receipt: 'receipt' in first ? first.receipt : undefined,
        });
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
    });

    it('rejects reuse of the same project and idempotency key for different batch content', async () => {
        const first = compileBatch();
        const conflicting = compileBatch({
            baseRevision: revision(1),
            batchId: 'batch-conflicting',
            expectedGain: 0.8,
            gain: 0.6,
            runId: 'run-conflicting',
        });

        const committed = await executeVersionedCommandBatchEnvelope({
            authority: first.authority,
            confirmed: true,
            serialized: first.serialized,
        });
        const rejected = await executeVersionedCommandBatchEnvelope({
            authority: conflicting.authority,
            confirmed: true,
            serialized: conflicting.serialized,
        });

        expect(committed.status).toBe('committed');
        expect(rejected).toMatchObject({
            status: 'rejected',
            reason: 'Idempotency key was already used for different batch content',
            receipt: { outcome: 'rejected' },
        });
        expect(projectDocument).toMatchObject({ trackGain: { value: 0.8 } });
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
    });

    it('retries reconciliation after completion crashes without duplicating external effects', async () => {
        rejectProjectReceiptFinalization = true;
        rejectReceiptPersistence = true;
        const batch = compileBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: () => Promise.resolve(true),
            release: () => Promise.resolve(),
        });
        runtimeEffectCount = 0;
        runtimeGain = 1;
        const interruptedRecovery = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        rejectProjectReceiptFinalization = false;
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(first.status).toBe('committed-with-warning');
        expect('warning' in first ? first.warning : '').toContain('post-commit receipt finalization was interrupted');
        expect('receipt' in first ? first.receipt.outcome : null).toBe('partially-committed');
        expect(interruptedRecovery).toMatchObject({
            status: 'ambiguous',
            reason: 'Idempotency checkpoint finalization failed: project receipt finalization unavailable',
        });
        expect(retry).toMatchObject({
            status: 'idempotent-replay',
            actions: [],
            receipt: {
                outcome: 'committed',
                errors: [],
                modelSummary: expect.stringContaining('external effects were reconciled successfully'),
            },
        });
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
    });

    it('recovers only the failed runtime effect from a mixed batch without replaying project truth', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        const panStorage = createAutomergeStorage<{ value: number }>('root', 'trackPan');
        expect(gainStorage.hydrate?.()).toBe(true);
        expect(panStorage.hydrate?.()).toBe(true);
        const gainRuntimeEffect = vi.fn(() => Promise.resolve());
        let panEffectAttempts = 0;
        const panRuntimeEffect = vi.fn(() => {
            panEffectAttempts += 1;
            return panEffectAttempts <= 2 ? Promise.reject(new Error('pan runtime unavailable')) : Promise.resolve();
        });
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    return {
                        status: 'written',
                        afterCommit: gainRuntimeEffect,
                        afterAmbiguousCommit: gainRuntimeEffect,
                    };
                },
            }),
            setTrackPan: {
                canReapplyAfterDivergence: () => true,
                describe: () => ({
                    inverseAction: {
                        type: 'setTrackPan',
                        payload: { trackId: 'track-vocal', pan: 0, expectedPan: -0.2 },
                    },
                    label: 'Pan vocal left',
                }),
                execute: () => {
                    panStorage.set({ value: -0.2 });
                    return {
                        status: 'written',
                        afterCommit: panRuntimeEffect,
                        afterAmbiguousCommit: panRuntimeEffect,
                    };
                },
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            } satisfies ActionHandler<SetTrackPanAction>,
        });
        const baseRevision = revision(0);
        const gainCommand = {
            ...createExecutionCommandEnvelope({
                action: {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                },
                expectedEffect: 'Set the vocal gain to 0.8.',
                normalizedProjectRevision: baseRevision,
            }).envelope,
            commandId: '11111111-1111-4111-8111-111111111111',
        };
        const panCommand = {
            ...createExecutionCommandEnvelope({
                action: {
                    type: 'setTrackPan',
                    payload: { trackId: 'track-vocal', pan: -0.2, expectedPan: 0 },
                },
                expectedEffect: 'Pan the vocal left.',
                normalizedProjectRevision: baseRevision,
            }).envelope,
            commandId: '22222222-2222-4222-8222-222222222222',
        };
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision,
            batchId: 'batch-mixed-runtime-recovery',
            commands: [JSON.stringify(gainCommand), JSON.stringify(panCommand)],
            idempotencyKey: 'client-request-mixed-runtime',
            intent: 'Set vocal gain and pan',
            mode: 'commit',
            projectId: 'project-idempotency',
            runId: 'run-mixed-runtime-recovery',
        });

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        const mutationsAfterCommit = mutationCount;
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: () => Promise.resolve(true),
            release: () => Promise.resolve(),
        });
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(first).toMatchObject({
            status: 'committed-with-warning',
            receipt: {
                pendingEffects: [
                    expect.objectContaining({
                        commandId: '22222222-2222-4222-8222-222222222222',
                        operation: 'setTrackPan',
                    }),
                ],
            },
        });
        expect(retry).toMatchObject({ status: 'idempotent-replay', recoveredExternalEffects: true });
        expect(gainRuntimeEffect).toHaveBeenCalledOnce();
        expect(panRuntimeEffect).toHaveBeenCalledTimes(3);
        expect(projectDocument).toMatchObject({ trackGain: { value: 0.8 }, trackPan: { value: -0.2 } });
        expect(mutationCount).toBe(mutationsAfterCommit + 1);
    });

    it('finds a pending project checkpoint before an empty local idempotency cache', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        let effectAttempts = 0;
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    const runtimeEffect = () => {
                        effectAttempts += 1;
                        return Promise.reject(new Error('runtime strip unavailable'));
                    };
                    return {
                        status: 'written',
                        afterCommit: runtimeEffect,
                        afterAmbiguousCommit: runtimeEffect,
                    };
                },
            }),
        });
        const batch = compileBatch();
        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        expect(first).toMatchObject({ status: 'committed-with-warning', receipt: { outcome: 'partially-committed' } });
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });

        const replay = await getVersionedCommandBatchIdempotentReplay({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(replay).toMatchObject({
            outcome: 'partially-committed',
            pendingEffects: [expect.objectContaining({ commandId: '11111111-1111-4111-8111-111111111111' })],
        });
        expect(effectAttempts).toBe(2);
    });

    it('routes needs-reconcile runtime truth through a current-project rebuild instead of exact effect retry', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        const repairRuntimeFromProject = vi.fn(() => Promise.resolve());
        commandRuntimeRepairPort.setProvider(repairRuntimeFromProject);
        let exactEffectAttempts = 0;
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    const runtimeEffect = () => {
                        exactEffectAttempts += 1;
                        throw Object.assign(new Error('runtime graph changed before failure'), {
                            pendingEffect: {
                                kind: 'runtime-graph' as const,
                                reason: 'runtime graph changed before failure',
                                remediation: 'repair' as const,
                                state: 'pending' as const,
                            },
                        });
                    };
                    return {
                        status: 'written',
                        afterCommit: runtimeEffect,
                        afterAmbiguousCommit: runtimeEffect,
                    };
                },
            }),
        });
        const batch = compileBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: () => Promise.resolve(true),
            release: () => Promise.resolve(),
        });
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(first).toMatchObject({
            status: 'committed-with-warning',
            receipt: {
                pendingEffects: [expect.objectContaining({ remediation: 'repair' })],
            },
        });
        expect(retry).toMatchObject({ status: 'idempotent-replay', recoveredExternalEffects: true });
        expect(exactEffectAttempts).toBe(2);
        expect(repairRuntimeFromProject).toHaveBeenCalledOnce();
    });

    it('does not clear a generic pending effect when runtime graph repair also runs', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        const panStorage = createAutomergeStorage<{ value: number }>('root', 'trackPan');
        expect(gainStorage.hydrate?.()).toBe(true);
        expect(panStorage.hydrate?.()).toBe(true);
        const repairRuntimeFromProject = vi.fn(() => Promise.resolve());
        let panReconcileAttempts = 0;
        const panReconcile = vi.fn(() => {
            panReconcileAttempts += 1;
            return panReconcileAttempts === 1
                ? Promise.reject(new Error('render export queue unavailable'))
                : Promise.resolve();
        });
        commandRuntimeRepairPort.setProvider(repairRuntimeFromProject);
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    const runtimeEffect = () => {
                        throw Object.assign(new Error('runtime graph changed before failure'), {
                            pendingEffect: {
                                kind: 'runtime-graph' as const,
                                reason: 'runtime graph changed before failure',
                                remediation: 'repair' as const,
                                state: 'pending' as const,
                            },
                        });
                    };
                    return {
                        status: 'written',
                        afterCommit: runtimeEffect,
                        afterAmbiguousCommit: runtimeEffect,
                    };
                },
            }),
            setTrackPan: {
                canReapplyAfterDivergence: () => true,
                describe: () => ({
                    inverseAction: {
                        type: 'setTrackPan',
                        payload: { trackId: 'track-vocal', pan: 0, expectedPan: -0.2 },
                    },
                    label: 'Pan vocal left',
                }),
                execute: () => {
                    panStorage.set({ value: -0.2 });
                    return {
                        status: 'written',
                        afterCommit: () => Promise.reject(new Error('render export queue unavailable')),
                        afterAmbiguousCommit: panReconcile,
                    };
                },
                previewExecution: 'isolated-project',
                undoable: true,
                validate: () => true,
            } satisfies ActionHandler<SetTrackPanAction>,
        });
        const baseRevision = revision(0);
        const gainCommand = {
            ...createExecutionCommandEnvelope({
                action: {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                },
                expectedEffect: 'Set the vocal gain to 0.8.',
                normalizedProjectRevision: baseRevision,
            }).envelope,
            commandId: '11111111-1111-4111-8111-111111111111',
        };
        const panCommand = {
            ...createExecutionCommandEnvelope({
                action: {
                    type: 'setTrackPan',
                    payload: { trackId: 'track-vocal', pan: -0.2, expectedPan: 0 },
                },
                expectedEffect: 'Pan the vocal left.',
                normalizedProjectRevision: baseRevision,
            }).envelope,
            commandId: '22222222-2222-4222-8222-222222222222',
        };
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision,
            batchId: 'batch-runtime-and-generic-recovery',
            commands: [JSON.stringify(gainCommand), JSON.stringify(panCommand)],
            idempotencyKey: 'client-request-runtime-and-generic',
            intent: 'Set vocal gain and pan',
            mode: 'commit',
            projectId: 'project-idempotency',
            runId: 'run-runtime-and-generic-recovery',
        });

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: () => Promise.resolve(true),
            release: () => Promise.resolve(),
        });
        panReconcile.mockClear();
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(first).toMatchObject({
            status: 'committed-with-warning',
            receipt: {
                pendingEffects: [
                    expect.objectContaining({ kind: 'runtime-graph', remediation: 'repair' }),
                    expect.objectContaining({ kind: 'external-effect', remediation: 'reconcile' }),
                ],
            },
        });
        expect(retry).toMatchObject({ status: 'idempotent-replay', recoveredExternalEffects: true });
        expect(repairRuntimeFromProject).toHaveBeenCalledOnce();
        expect(panReconcile).toHaveBeenCalledOnce();
    });

    it('does not settle a diverged generic effect through runtime graph repair', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        const repairRuntimeFromProject = vi.fn(() => Promise.resolve());
        let reconcileAttempts = 0;
        commandRuntimeRepairPort.setProvider(repairRuntimeFromProject);
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    return {
                        status: 'written',
                        afterCommit: () => Promise.reject(new Error('render export queue unavailable')),
                        afterAmbiguousCommit: () => {
                            reconcileAttempts += 1;
                            return reconcileAttempts === 1
                                ? Promise.reject(new Error('render export queue unavailable'))
                                : Promise.resolve();
                        },
                    };
                },
            }),
        });
        const batch = compileBatch({ batchId: 'batch-diverged-generic-effect', runId: 'run-diverged-generic-effect' });

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        projectDocument = { ...projectDocument, trackGain: { value: 0.5 } };
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: () => Promise.resolve(true),
            release: () => Promise.resolve(),
        });
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(first).toMatchObject({
            status: 'committed-with-warning',
            receipt: {
                pendingEffects: [expect.objectContaining({ kind: 'external-effect', remediation: 'reconcile' })],
            },
        });
        expect(retry).toMatchObject({
            status: 'ambiguous',
            reason: 'Pending external effect cannot be retried exactly',
        });
        expect(repairRuntimeFromProject).not.toHaveBeenCalled();
    });

    it('does not consume the idempotency key before commit authority is confirmed', async () => {
        const batch = compileBatch();

        const unconfirmed = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });
        const confirmed = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(unconfirmed).toMatchObject({
            status: 'rejected',
            reason: 'Commit batch requires an exact approval binding',
        });
        expect(confirmed.status).toBe('committed');
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
    });

    it('reclaims an orphaned pre-commit claim when project truth proves no commit occurred', async () => {
        const claim = vi.fn((input: { reclaimPending?: boolean }) =>
            Promise.resolve(input.reclaimPending ? ({ status: 'claimed' } as const) : ({ status: 'pending' } as const))
        );
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'pending' }),
            claim,
            complete: () => Promise.resolve(),
        });
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('committed');
        expect(claim).toHaveBeenCalledWith(expect.objectContaining({ reclaimPending: true }));
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
    });

    it('serializes recovery while a committed batch reconciles its failed external effect', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        let effectAttempts = 0;
        let markRecoveryStarted!: () => void;
        let releaseRecoveryEffect!: () => void;
        const recoveryStarted = new Promise<void>((resolve) => {
            markRecoveryStarted = resolve;
        });
        const recoveryEffectGate = new Promise<void>((resolve) => {
            releaseRecoveryEffect = resolve;
        });
        let recoveryLeaseHeld = false;
        const tryAcquireRecoveryLease = vi.fn(() => {
            if (recoveryLeaseHeld) {
                return Promise.resolve(false);
            }
            recoveryLeaseHeld = true;
            return Promise.resolve(true);
        });
        const release = vi.fn(() => {
            recoveryLeaseHeld = false;
            return Promise.resolve();
        });
        const recoveryAwareRepository = {
            lookup: () => Promise.resolve({ status: 'missing' as const }),
            claim: () => Promise.resolve({ status: 'claimed' as const }),
            complete: () => {
                recoveryLeaseHeld = false;
                return Promise.resolve();
            },
            release,
            tryAcquireRecoveryLease,
        };
        commandBatchIdempotencyPort.setRepository(recoveryAwareRepository);
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    const applyRuntimeEffect = async () => {
                        effectAttempts += 1;
                        if (effectAttempts <= 2) {
                            throw new Error('runtime strip unavailable');
                        }
                        if (effectAttempts === 3) {
                            markRecoveryStarted();
                            await recoveryEffectGate;
                        }
                        runtimeGain = 0.8;
                        runtimeEffectCount += 1;
                    };
                    return {
                        status: 'written',
                        afterCommit: applyRuntimeEffect,
                        afterAmbiguousCommit: applyRuntimeEffect,
                    };
                },
            }),
        });
        const batch = compileBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        const retryPromise = executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        await recoveryStarted;
        const concurrentRetry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        releaseRecoveryEffect();
        const retry = await retryPromise;
        const settledRetry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(first).toMatchObject({
            status: 'committed-with-warning',
            receipt: { outcome: 'partially-committed' },
        });
        expect(retry).toMatchObject({
            status: 'idempotent-replay',
            receipt: { outcome: 'committed', errors: [] },
        });
        expect('receipt' in retry ? retry.receipt.warnings : []).not.toContain(
            expect.stringContaining('runtime strip unavailable')
        );
        expect(concurrentRetry).toMatchObject({
            status: 'ambiguous',
            reason: 'Command batch external-effect recovery is already in progress',
        });
        expect(settledRetry).toMatchObject({
            status: 'idempotent-replay',
            receipt: { outcome: 'committed', errors: [] },
        });
        expect(tryAcquireRecoveryLease).toHaveBeenCalledTimes(2);
        expect(release).toHaveBeenCalledTimes(1);
        expect(effectAttempts).toBe(3);
        expect(runtimeEffectCount).toBe(1);
        expect(runtimeGain).toBe(0.8);
        expect(mutationCount).toBe(3);
    });

    it('re-reads project truth after waiting for the recovery lease', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        let effectAttempts = 0;
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    const applyRuntimeEffect = () => {
                        effectAttempts += 1;
                        if (effectAttempts <= 2) {
                            return Promise.reject(new Error('runtime strip unavailable'));
                        }
                        runtimeGain = 0.8;
                        runtimeEffectCount += 1;
                        return Promise.resolve();
                    };
                    return {
                        status: 'written',
                        afterCommit: applyRuntimeEffect,
                        afterAmbiguousCommit: applyRuntimeEffect,
                    };
                },
            }),
        });
        let markRecoveryLeaseRequested!: () => void;
        let grantRecoveryLease!: () => void;
        const recoveryLeaseRequested = new Promise<void>((resolve) => {
            markRecoveryLeaseRequested = resolve;
        });
        const recoveryLeaseGate = new Promise<void>((resolve) => {
            grantRecoveryLease = resolve;
        });
        const release = vi.fn(() => Promise.resolve());
        const recoveryAwareRepository = {
            lookup: () => Promise.resolve({ status: 'missing' as const }),
            claim: () => Promise.resolve({ status: 'claimed' as const }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: async () => {
                markRecoveryLeaseRequested();
                await recoveryLeaseGate;
                return true;
            },
            release,
        };
        commandBatchIdempotencyPort.setRepository(recoveryAwareRepository);
        const batch = compileBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        expect(first).toMatchObject({ status: 'committed-with-warning', receipt: { outcome: 'partially-committed' } });

        const retryPromise = executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        await recoveryLeaseRequested;
        runtimeGain = 0.8;
        runtimeEffectCount = 1;
        persistProjectCommandBatchIdempotencyCheckpoint({
            projectId: 'project-idempotency',
            idempotencyKey: 'client-request-1',
            contentHash: await getCommandBatchContentHash(
                JSON.parse(batch.serialized) as Parameters<typeof getCommandBatchContentHash>[0]
            ),
            state: 'complete',
            serializedReceipt: JSON.stringify('receipt' in first ? first.receipt : null),
        });
        grantRecoveryLease();
        const retry = await retryPromise;

        expect(retry.status).toBe('idempotent-replay');
        expect(effectAttempts).toBe(2);
        expect(runtimeEffectCount).toBe(1);
        expect(runtimeGain).toBe(0.8);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('rechecks host authority after waiting for the recovery lease', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        let effectAttempts = 0;
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    const applyRuntimeEffect = () => {
                        effectAttempts += 1;
                        if (effectAttempts <= 2) {
                            return Promise.reject(new Error('runtime strip unavailable'));
                        }
                        runtimeGain = 0.8;
                        runtimeEffectCount += 1;
                        return Promise.resolve();
                    };
                    return {
                        status: 'written',
                        afterCommit: applyRuntimeEffect,
                        afterAmbiguousCommit: applyRuntimeEffect,
                    };
                },
            }),
        });
        let markRecoveryLeaseRequested!: () => void;
        let grantRecoveryLease!: () => void;
        const recoveryLeaseRequested = new Promise<void>((resolve) => {
            markRecoveryLeaseRequested = resolve;
        });
        const recoveryLeaseGate = new Promise<void>((resolve) => {
            grantRecoveryLease = resolve;
        });
        const release = vi.fn(() => Promise.resolve());
        const recoveryAwareRepository = {
            lookup: () => Promise.resolve({ status: 'missing' as const }),
            claim: () => Promise.resolve({ status: 'claimed' as const }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: async () => {
                markRecoveryLeaseRequested();
                await recoveryLeaseGate;
                return true;
            },
            release,
        };
        commandBatchIdempotencyPort.setRepository(recoveryAwareRepository);
        const batch = compileBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        expect(first.status).toBe('committed-with-warning');

        const retryPromise = executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        await recoveryLeaseRequested;
        commandBatchExecutionAuthorityPort.setProvider(() => false);
        grantRecoveryLease();
        const retry = await retryPromise;

        expect(retry).toMatchObject({
            status: 'ambiguous',
            reason: 'Only the authoritative collaboration host can reconcile a durable command batch',
        });
        expect(effectAttempts).toBe(2);
        expect(runtimeEffectCount).toBe(0);
        expect(runtimeGain).toBe(1);
        expect(release).toHaveBeenCalledTimes(1);
    });

    it('rechecks host authority after async claim admission and before project execution', async () => {
        let resolveClaim!: () => void;
        let markClaimStarted!: () => void;
        const claimStarted = new Promise<void>((resolve) => {
            markClaimStarted = resolve;
        });
        const claimGate = new Promise<void>((resolve) => {
            resolveClaim = resolve;
        });
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: async () => {
                markClaimStarted();
                await claimGate;
                return { status: 'claimed' };
            },
            complete: () => Promise.resolve(),
        });
        const batch = compileBatch();

        const execution = executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        await claimStarted;
        commandBatchExecutionAuthorityPort.setProvider(() => false);
        resolveClaim();
        const result = await execution;

        expect(result.status).toBe('cancelled');
        expect(mutationCount).toBe(0);
        expect(runtimeEffectCount).toBe(0);
    });

    it('admits one concurrent claim and prevents the retry from duplicating effects', async () => {
        const batch = compileBatch();
        let releaseRuntimeEffect!: () => void;
        runtimeEffectGate = new Promise<void>((resolve) => {
            releaseRuntimeEffect = resolve;
        });

        const firstPromise = executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        await vi.waitFor(() => expect(mutationCount).toBe(1));
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        releaseRuntimeEffect();
        const first = await firstPromise;

        expect(first.status).toBe('committed');
        expect(retry).toMatchObject({
            status: 'ambiguous',
            reason: 'An identical command batch is already in progress',
        });
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
    });

    it('rejects an invalid stored receipt before project or runtime effects', async () => {
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'complete', serializedReceipt: '{"schemaVersion":1}' }),
            claim: () => Promise.resolve({ status: 'complete', serializedReceipt: '{"schemaVersion":1}' }),
            complete: vi.fn(() => Promise.resolve()),
        });
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result).toEqual({
            status: 'rejected',
            reason: 'Stored idempotency receipt is invalid',
            actions: [],
        });
        expect(mutationCount).toBe(0);
        expect(runtimeEffectCount).toBe(0);
    });

    it.each([
        ['forward-versioned', { schemaVersion: 2, records: [] }],
        ['malformed', { records: [{ id: 'corrupt' }] }],
    ])('fails closed when the project idempotency ledger is %s', async (_case, storedLedger) => {
        projectDocument.commandBatchIdempotency = storedLedger;
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Project idempotency ledger schema is unsupported',
        });
        expect(projectDocument.commandBatchIdempotency).toEqual(storedLedger);
        expect(mutationCount).toBe(0);
        expect(runtimeEffectCount).toBe(0);
    });

    it('fails closed before effects when durable idempotency admission is unavailable', async () => {
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.reject(new Error('durable store unavailable')),
            complete: vi.fn(() => Promise.resolve()),
        });
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result).toMatchObject({
            status: 'rejected',
            reason: 'Command batch idempotency admission failed: durable store unavailable',
            receipt: { outcome: 'rejected' },
        });
        expect(mutationCount).toBe(0);
        expect(runtimeEffectCount).toBe(0);
    });

    it('hashes canonical batch content independently of object key insertion order', async () => {
        const batch = compileBatch();
        const parsed = JSON.parse(batch.serialized) as Record<string, unknown>;
        const reordered = Object.fromEntries(Object.entries(parsed).toReversed());
        reordered.idempotencyKey = 'another-client-retry-key';

        const [originalHash, reorderedHash] = await Promise.all([
            getCommandBatchContentHash(parsed as Parameters<typeof getCommandBatchContentHash>[0]),
            getCommandBatchContentHash(reordered as Parameters<typeof getCommandBatchContentHash>[0]),
        ]);
        expect(originalHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(reorderedHash).toMatch(/^sha256:[a-f0-9]{64}$/);
        expect(reorderedHash).toBe(originalHash);
    });
});
