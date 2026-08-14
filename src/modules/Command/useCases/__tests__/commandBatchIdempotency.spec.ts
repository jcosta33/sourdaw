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
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { configureCommandBatchIdempotency } from '../configureCommandBatchIdempotency';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';
import { getCommandBatchContentHash } from '../getCommandBatchContentHash';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

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
        projectDocument = { trackGain: { value: 1 } };
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
        commandBatchIdempotencyPort.setRepository(null);
        commandBatchExecutionAuthorityPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
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
        expect('receipt' in first ? first.receipt.outcome : null).toBe('committed-with-warning');
        expect(interruptedRecovery).toMatchObject({
            status: 'ambiguous',
            reason: 'Idempotency checkpoint finalization failed: project receipt finalization unavailable',
        });
        expect(retry).toEqual({
            status: 'idempotent-replay',
            actions: [],
            receipt: 'receipt' in first ? first.receipt : undefined,
        });
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
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
            reason: 'Commit batch requires confirmation or the auto-commit grant',
        });
        expect(confirmed.status).toBe('committed');
        expect(mutationCount).toBe(2);
        expect(runtimeEffectCount).toBe(1);
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
