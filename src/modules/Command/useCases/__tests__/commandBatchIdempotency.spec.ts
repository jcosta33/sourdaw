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

import { type CommandBatchIdempotencyRepository } from '../../models/CommandBatchIdempotency';
import { commandBatchIdempotencyStore } from '../../stores/commandBatchIdempotencyStore';
import { commandBatchExecutionAuthorityPort } from '../commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from '../commandBatchIdempotencyPort';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandBatchPreviewPort } from '../commandBatchPreviewPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { commandRuntimeRepairPort } from '../commandRuntimeRepairPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { configureCommandBatchIdempotency } from '../configureCommandBatchIdempotency';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { createRecoveredVerifiedBatchReceipt } from '../createRecoveredVerifiedBatchReceipt';
import { createVerifiedBatchReceipt } from '../createVerifiedBatchReceipt';
import { createVersionedCommandReceipt } from '../createVersionedCommandReceipt';
import { getCommandBatchContentHash } from '../getCommandBatchContentHash';
import { getProjectCommandBatchIdempotencyCheckpoint } from '../getProjectCommandBatchIdempotencyCheckpoint';
import { getVersionedCommandBatchCommitDisposition } from '../getVersionedCommandBatchCommitDisposition';
import { getVersionedCommandBatchCommitProof } from '../getVersionedCommandBatchCommitProof';
import { getVersionedCommandBatchIdempotentReplay } from '../getVersionedCommandBatchIdempotentReplay';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { persistProjectCommandBatchIdempotencyCheckpoint } from '../persistProjectCommandBatchIdempotencyCheckpoint';

import { executeApprovedVersionedCommandBatchEnvelope as executeVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;
type SetTrackPanAction = Extract<AppAction, { type: 'setTrackPan' }>;
type SetPlaybackAction = Extract<AppAction, { type: 'setPlayback' }>;

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

function compileRuntimeBatch() {
    const baseRevision = revision(0);
    const action: SetPlaybackAction = { type: 'setPlayback', payload: { playing: true } };
    const command = {
        ...createExecutionCommandEnvelope({
            action,
            expectedEffect: 'Start playback.',
            normalizedProjectRevision: baseRevision,
        }).envelope,
        commandId: '33333333-3333-4333-8333-333333333333',
    };
    return compileVersionedCommandBatchEnvelope({
        baseRevision,
        batchId: 'batch-runtime-warning',
        commands: [JSON.stringify(command)],
        idempotencyKey: 'client-request-runtime-warning',
        intent: 'Start playback',
        mode: 'commit',
        projectId: 'project-idempotency',
        runId: 'run-runtime-warning',
    });
}

describe('command batch idempotency', () => {
    const durableStorageKey = 'sourdaw:command-batch-idempotency:v1';
    let mutationCount: number;
    let projectDocument: Record<string, unknown>;
    let projectRevisionOverride: string | null;
    let rejectInitialProjectCommit: boolean;
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
        projectRevisionOverride = null;
        rejectInitialProjectCommit = false;
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
                if (rejectInitialProjectCommit && mutationCount === 0) {
                    throw new Error('initial project commit unavailable');
                }
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
        commandProjectRevisionPort.setProvider(() => projectRevisionOverride ?? revision(mutationCount));
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

    it('distinguishes an exact terminal non-commit receipt from missing proof', async () => {
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
            options: { shouldExecute: () => false },
        });
        const proof = await getVersionedCommandBatchCommitProof(batch);

        expect(result.status).toBe('cancelled');
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('terminal-noncommit');
        await expect(
            getVersionedCommandBatchCommitDisposition({ ...proof, contentHash: `sha256:${'f'.repeat(64)}` })
        ).resolves.toBe('unknown');
    });

    it('preserves a fresh approved batch revision while replay is probed without durable idempotency', async () => {
        commandBatchIdempotencyPort.setRepository(null);
        const batch = compileBatch();
        const proposalRevision = commandProjectRevisionPort.capture();
        const hydrateLedger = vi.spyOn(commandBatchIdempotencyStore, 'hydrate');

        await expect(
            getVersionedCommandBatchIdempotentReplay({
                authority: batch.authority,
                serialized: batch.serialized,
            })
        ).resolves.toBeNull();

        expect(commandProjectRevisionPort.capture()).toBe(proposalRevision);
        expect(mutationCount).toBe(0);
        expect(hydrateLedger).not.toHaveBeenCalled();
        expect(projectDocument).not.toHaveProperty('commandBatchIdempotency');

        await expect(
            executeVersionedCommandBatchEnvelope({
                authority: batch.authority,
                confirmed: true,
                serialized: batch.serialized,
            })
        ).resolves.toMatchObject({ status: 'committed' });

        expect(mutationCount).toBe(1);
        expect(projectDocument).toMatchObject({ trackGain: { value: 0.8 } });
        expect(runtimeEffectCount).toBe(1);
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

        await expect(
            getVersionedCommandBatchCommitDisposition(await getVersionedCommandBatchCommitProof(batch))
        ).resolves.toBe('committed');
    });

    it('replays a completed runtime warning receipt without repeating the runtime action', async () => {
        const afterRuntimeExecution = vi.fn().mockRejectedValue(new Error('transport event unavailable'));
        const execute = vi.fn(() => ({ status: 'written' as const, afterRuntimeExecution }));
        registerHandlerMap({
            setPlayback: {
                describe: () => ({ label: 'Start playback' }),
                execute,
                executionKind: 'runtime',
                undoable: false,
                validate: () => true,
            },
        });
        const batch = compileRuntimeBatch();

        const first = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });
        const retry = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });

        expect(first).toMatchObject({
            status: 'executed-with-warning',
            receipt: {
                atomicity: 'atomic',
                outcome: 'executed-with-warning',
            },
        });
        expect(retry).toEqual({
            status: 'idempotent-replay',
            actions: [],
            receipt: 'receipt' in first ? first.receipt : undefined,
        });
        expect(execute).toHaveBeenCalledOnce();
        expect(afterRuntimeExecution).toHaveBeenCalledOnce();
    });

    it('treats only the exact verified receipt as committed proof', async () => {
        const batch = compileBatch();
        const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const command = parsed.envelope.commands[0];
        if (!command) {
            throw new Error('The proof batch did not contain a command');
        }
        const expectedProof = {
            baseRevision: revision(0),
            batchId: 'batch-idempotency',
            commands: [{ commandId: '11111111-1111-4111-8111-111111111111', operation: 'setTrackGain' }],
            contentHash: await getCommandBatchContentHash(parsed.envelope),
            idempotencyKey: 'client-request-1',
            projectId: 'project-idempotency',
            runId: 'run-idempotency',
        };
        const proof = await getVersionedCommandBatchCommitProof(batch);
        expect(proof).toEqual(expectedProof);
        const receipt = JSON.stringify(
            createVerifiedBatchReceipt({
                contentHash: expectedProof.contentHash,
                envelope: parsed.envelope,
                observedBaseRevision: parsed.envelope.baseRevision,
                resultingRevision: revision(1),
                result: {
                    actions: [
                        {
                            action: {
                                type: 'setTrackGain',
                                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                            },
                            receipt: createVersionedCommandReceipt({ envelope: command }),
                        },
                    ],
                    status: 'committed',
                },
            })
        );
        const receiptRecord = JSON.parse(receipt) as {
            base: { normalizedRevision: string };
            commandOutcomes: Array<{ commandId: string; operation: string; outcome: string }>;
        };
        const committedReceipts = [
            JSON.stringify(
                createVerifiedBatchReceipt({
                    contentHash: expectedProof.contentHash,
                    envelope: parsed.envelope,
                    observedBaseRevision: parsed.envelope.baseRevision,
                    resultingRevision: revision(1),
                    result: {
                        actions: [
                            {
                                action: {
                                    type: 'setTrackGain',
                                    payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                                },
                                receipt: createVersionedCommandReceipt({ envelope: command }),
                            },
                        ],
                        status: 'committed-with-warning',
                        warning: 'history observer unavailable',
                    },
                })
            ),
            JSON.stringify(
                createVerifiedBatchReceipt({
                    contentHash: expectedProof.contentHash,
                    envelope: parsed.envelope,
                    observedBaseRevision: parsed.envelope.baseRevision,
                    resultingRevision: revision(1),
                    result: {
                        actions: [
                            {
                                action: {
                                    type: 'setTrackGain',
                                    payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                                },
                                receipt: createVersionedCommandReceipt({ envelope: command }),
                            },
                        ],
                        status: 'committed-with-warning',
                        warningDetails: [
                            {
                                kind: 'external-effect',
                                commandId: command.commandId,
                                message: 'runtime graph update failed',
                                pendingEffect: {
                                    kind: 'runtime-graph',
                                    commandId: command.commandId,
                                    operation: command.operation,
                                    reason: 'runtime graph update failed',
                                    remediation: 'retry',
                                    state: 'pending',
                                },
                            },
                        ],
                    },
                })
            ),
        ];
        const receiptWithOutcome = (outcome: string, commandOutcome: string) =>
            JSON.stringify({
                ...receiptRecord,
                outcome,
                commandOutcomes: receiptRecord.commandOutcomes.map((command) => ({
                    ...command,
                    outcome: commandOutcome,
                })),
            });
        const lookup = vi.fn((input: { contentHash: string; idempotencyKey: string; projectId: string }) =>
            Promise.resolve(
                input.projectId === expectedProof.projectId &&
                    input.idempotencyKey === expectedProof.idempotencyKey &&
                    input.contentHash === expectedProof.contentHash
                    ? { status: 'complete' as const, serializedReceipt: receipt }
                    : { status: 'missing' as const }
            )
        );
        commandBatchIdempotencyPort.setRepository({
            lookup,
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });

        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('committed');
        for (const serializedReceipt of committedReceipts) {
            lookup.mockResolvedValueOnce({ status: 'complete', serializedReceipt });
            await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('committed');
        }
        const alteredContentHash = await getCommandBatchContentHash({
            ...parsed.envelope,
            commands: parsed.envelope.commands.map((candidate) =>
                candidate.commandId === command.commandId
                    ? { ...candidate, arguments: { ...candidate.arguments, gain: 0.5 } }
                    : candidate
            ),
        });
        lookup.mockResolvedValueOnce({ status: 'complete', serializedReceipt: receipt });
        await expect(
            getVersionedCommandBatchCommitDisposition({ ...proof, contentHash: alteredContentHash })
        ).resolves.toBe('unknown');
        lookup.mockResolvedValueOnce({
            status: 'complete',
            serializedReceipt: JSON.stringify({ ...receiptRecord, contentHash: undefined, schemaVersion: 1 }),
        });
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('unknown');
        await expect(
            getVersionedCommandBatchCommitDisposition({ ...proof, contentHash: `sha256:${'f'.repeat(64)}` })
        ).resolves.toBe('unknown');
        await expect(
            getVersionedCommandBatchCommitDisposition({ ...proof, idempotencyKey: 'other-client-request' })
        ).resolves.toBe('unknown');
        await expect(getVersionedCommandBatchCommitDisposition({ ...proof, projectId: 'other-project' })).resolves.toBe(
            'unknown'
        );

        lookup.mockResolvedValueOnce({ status: 'missing' });
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('unknown');

        lookup.mockResolvedValueOnce({ status: 'complete', serializedReceipt: '{"schemaVersion":1}' });
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('unknown');

        for (const serializedReceipt of [
            receiptWithOutcome('committed', 'no-op'),
            receiptWithOutcome('committed', 'executed'),
            receiptWithOutcome('committed', 'unknown'),
            receiptWithOutcome('committed', 'not-applied'),
            receiptWithOutcome('executed', 'executed'),
            JSON.stringify({ ...receiptRecord, runId: 'stale-run' }),
            JSON.stringify({ ...receiptRecord, batchId: 'stale-batch' }),
            JSON.stringify({
                ...receiptRecord,
                base: JSON.parse(revision(999)) as typeof receiptRecord.base,
            }),
            JSON.stringify({
                ...receiptRecord,
                commandOutcomes: receiptRecord.commandOutcomes.map((command) => ({
                    ...command,
                    commandId: '22222222-2222-4222-8222-222222222222',
                })),
            }),
            JSON.stringify({
                ...receiptRecord,
                commandOutcomes: receiptRecord.commandOutcomes.map((command) => ({
                    ...command,
                    operation: 'setTrackPan',
                })),
            }),
        ]) {
            lookup.mockResolvedValueOnce({ status: 'complete', serializedReceipt });
            await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('unknown');
        }
        for (const serializedReceipt of [
            receiptWithOutcome('no-op', 'no-op'),
            receiptWithOutcome('failed', 'not-applied'),
        ]) {
            lookup.mockResolvedValueOnce({ status: 'complete', serializedReceipt });
            await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('terminal-noncommit');
        }
    });

    it('rejects receipt reuse when only an application-assigned ID changes', async () => {
        const baseRevision = revision(0);
        const created = createExecutionCommandEnvelope({
            action: { type: 'addTrack', payload: { name: 'Lead Vocal', kind: 'audio', color: '#d946ef' } },
            expectedEffect: 'Add the Lead Vocal audio track.',
            normalizedProjectRevision: baseRevision,
        });
        const command = {
            ...created.envelope,
            commandId: '44444444-4444-4444-8444-444444444444',
        };
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision,
            batchId: 'batch-assigned-id-proof',
            commands: [JSON.stringify(command)],
            idempotencyKey: 'client-request-assigned-id-proof',
            intent: 'Add the Lead Vocal track',
            mode: 'commit',
            projectId: 'project-idempotency',
            runId: 'run-assigned-id-proof',
        });
        const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const parsedCommand = parsed.envelope.commands[0];
        const assignedId = parsedCommand?.applicationAssignedIds[0];
        if (!parsedCommand || !assignedId) {
            throw new Error('The assigned-ID proof batch did not materialize an application ID');
        }
        const proof = await getVersionedCommandBatchCommitProof(batch);
        const receipt = JSON.stringify(
            createVerifiedBatchReceipt({
                contentHash: proof.contentHash,
                envelope: parsed.envelope,
                observedBaseRevision: baseRevision,
                resultingRevision: revision(1),
                result: {
                    actions: [
                        {
                            action: created.action,
                            receipt: createVersionedCommandReceipt({ envelope: parsedCommand }),
                        },
                    ],
                    status: 'committed',
                },
            })
        );
        const alteredContentHash = await getCommandBatchContentHash({
            ...parsed.envelope,
            commands: parsed.envelope.commands.map((candidate) =>
                candidate.commandId === parsedCommand.commandId
                    ? {
                          ...candidate,
                          applicationAssignedIds: candidate.applicationAssignedIds.map((candidateId) =>
                              candidateId.argument === assignedId.argument
                                  ? { ...candidateId, value: `${candidateId.value}-altered` }
                                  : candidateId
                          ),
                      }
                    : candidate
            ),
        });
        const lookup = vi.fn(() => Promise.resolve({ status: 'complete' as const, serializedReceipt: receipt }));
        commandBatchIdempotencyPort.setRepository({
            lookup,
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });

        expect(parsedCommand.applicationAssignedIds.length).toBeGreaterThan(0);
        expect(alteredContentHash).not.toBe(proof.contentHash);
        await expect(
            getVersionedCommandBatchCommitDisposition({ ...proof, contentHash: alteredContentHash })
        ).resolves.toBe('unknown');
        expect(lookup).toHaveBeenCalledWith({ ...proof, contentHash: alteredContentHash });
    });

    it('classifies every producer-created receipt family through durable repository lookup', async () => {
        const batch = compileBatch();
        const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const command = parsed.envelope.commands[0];
        if (!command) {
            throw new Error('The receipt-family batch did not contain a command');
        }
        const proof = await getVersionedCommandBatchCommitProof(batch);
        type ProducerResult = Parameters<typeof createVerifiedBatchReceipt>[0]['result'];
        const actions: ProducerResult['actions'] = [
            {
                action: {
                    type: 'setTrackGain',
                    payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                },
                receipt: createVersionedCommandReceipt({ envelope: command }),
            },
        ];
        const pendingEffect = {
            commandId: command.commandId,
            kind: 'runtime-graph' as const,
            operation: 'setTrackGain' as const,
            reason: 'runtime graph revision is stale',
            remediation: 'retry' as const,
            state: 'pending' as const,
        };
        const cases: ReadonlyArray<{
            disposition: 'committed' | 'terminal-noncommit' | 'unknown';
            name: string;
            outcome:
                | 'committed'
                | 'committed-with-warning'
                | 'partially-committed'
                | 'executed'
                | 'executed-with-warning'
                | 'ambiguous'
                | 'no-op'
                | 'rejected'
                | 'conflicted'
                | 'cancelled'
                | 'failed'
                | 'verification-failed';
            result: ProducerResult;
        }> = [
            {
                name: 'committed',
                outcome: 'committed',
                result: { status: 'committed', actions },
                disposition: 'committed',
            },
            {
                name: 'committed-with-warning',
                outcome: 'committed-with-warning',
                result: {
                    status: 'committed-with-warning',
                    actions,
                    warningDetails: [{ kind: 'observer', message: 'history observer unavailable' }],
                },
                disposition: 'committed',
            },
            {
                name: 'partially-committed',
                outcome: 'partially-committed',
                result: {
                    status: 'committed-with-warning',
                    actions,
                    warningDetails: [
                        {
                            kind: 'external-effect',
                            commandId: command.commandId,
                            message: 'runtime graph update failed',
                            pendingEffect,
                        },
                    ],
                },
                disposition: 'committed',
            },
            {
                name: 'executed',
                outcome: 'executed',
                result: { status: 'executed', actions },
                disposition: 'unknown',
            },
            {
                name: 'executed-with-warning',
                outcome: 'executed-with-warning',
                result: {
                    status: 'executed-with-warning',
                    actions,
                    warningDetails: [
                        {
                            kind: 'external-effect',
                            commandId: command.commandId,
                            message: 'runtime graph update failed',
                        },
                    ],
                },
                disposition: 'unknown',
            },
            {
                name: 'ambiguous',
                outcome: 'ambiguous',
                result: { status: 'ambiguous', actions: [], reason: 'unknown commit state' },
                disposition: 'unknown',
            },
            {
                name: 'no-op',
                outcome: 'no-op',
                result: { status: 'no-op', actions: [] },
                disposition: 'terminal-noncommit',
            },
            {
                name: 'rejected',
                outcome: 'rejected',
                result: { status: 'rejected', actions: [], reason: 'request rejected' },
                disposition: 'terminal-noncommit',
            },
            {
                name: 'conflicted',
                outcome: 'conflicted',
                result: { status: 'conflicted', actions: [], reason: 'project conflict' },
                disposition: 'terminal-noncommit',
            },
            {
                name: 'cancelled',
                outcome: 'cancelled',
                result: { status: 'cancelled', actions: [], reason: 'execution cancelled' },
                disposition: 'terminal-noncommit',
            },
            {
                name: 'failed',
                outcome: 'failed',
                result: { status: 'failed', actions: [], reason: 'execution failed' },
                disposition: 'terminal-noncommit',
            },
            {
                name: 'verification-failed',
                outcome: 'verification-failed',
                result: {
                    status: 'conflicted',
                    actions: [],
                    reason: 'protected target changed',
                    failureKind: 'verification',
                },
                disposition: 'terminal-noncommit',
            },
        ];
        const lookup = vi.fn();
        commandBatchIdempotencyPort.setRepository({
            lookup,
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });

        for (const testCase of cases) {
            const receipt = createVerifiedBatchReceipt({
                contentHash: proof.contentHash,
                envelope: parsed.envelope,
                observedBaseRevision: parsed.envelope.baseRevision,
                resultingRevision: testCase.disposition === 'committed' ? revision(1) : revision(0),
                result: testCase.result,
            });
            expect(receipt, testCase.name).toMatchObject({ schemaVersion: 2, outcome: testCase.outcome });
            const serializedReceipt = JSON.stringify(receipt);
            lookup.mockResolvedValueOnce({ status: 'complete', serializedReceipt });

            await expect(getVersionedCommandBatchCommitDisposition(proof), testCase.name).resolves.toBe(
                testCase.disposition
            );
        }

        expect(lookup).toHaveBeenCalledTimes(cases.length);
        expect(lookup.mock.calls.every(([candidate]) => candidate === proof)).toBe(true);
    });

    it('accepts a recovery-produced committed receipt through durable repository lookup', async () => {
        const batch = compileBatch();
        const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const command = parsed.envelope.commands[0];
        if (!command) {
            throw new Error('The recovered receipt batch did not contain a command');
        }
        const proof = await getVersionedCommandBatchCommitProof(batch);
        const priorReceipt = createVerifiedBatchReceipt({
            contentHash: proof.contentHash,
            envelope: parsed.envelope,
            observedBaseRevision: parsed.envelope.baseRevision,
            resultingRevision: revision(1),
            result: {
                status: 'committed-with-warning',
                actions: [
                    {
                        action: {
                            type: 'setTrackGain',
                            payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                        },
                        receipt: createVersionedCommandReceipt({ envelope: command }),
                    },
                ],
                warningDetails: [
                    {
                        kind: 'external-effect',
                        commandId: command.commandId,
                        message: 'runtime graph update failed',
                        pendingEffect: {
                            commandId: command.commandId,
                            kind: 'runtime-graph',
                            operation: 'setTrackGain',
                            reason: 'runtime graph update failed',
                            remediation: 'retry',
                            state: 'pending',
                        },
                    },
                ],
            },
        });
        const recoveredReceipt = createRecoveredVerifiedBatchReceipt({
            contentHash: proof.contentHash,
            envelope: parsed.envelope,
            priorReceipt,
            receiptWarnings: ['Recovered pending external effects.'],
        });
        const lookup = vi.fn(() =>
            Promise.resolve({
                status: 'complete' as const,
                serializedReceipt: JSON.stringify(recoveredReceipt),
            })
        );
        delete projectDocument.commandBatchIdempotency;
        commandBatchIdempotencyPort.setRepository({
            lookup,
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });

        expect(priorReceipt).toMatchObject({
            outcome: 'partially-committed',
            pendingEffects: [{ commandId: command.commandId, state: 'pending' }],
        });
        expect(recoveredReceipt).toMatchObject({
            schemaVersion: 2,
            contentHash: proof.contentHash,
            outcome: 'committed',
            atomicity: 'atomic',
            pendingEffects: [],
        });
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('committed');
        expect(lookup).toHaveBeenCalledOnce();
        expect(lookup).toHaveBeenCalledWith(proof);
    });

    it('fails closed for non-complete project evidence and repository lookup failures', async () => {
        const batch = compileBatch();
        const proof = await getVersionedCommandBatchCommitProof(batch);
        const lookup = vi.fn<CommandBatchIdempotencyRepository['lookup']>(() =>
            Promise.resolve({ status: 'complete', serializedReceipt: '{}' })
        );
        commandBatchIdempotencyPort.setRepository({
            lookup,
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });
        const projectRecord = (contentHash: string, serializedReceipt: string) => ({
            contentHash,
            id: `${proof.projectId}\u0000${proof.idempotencyKey}\u0000${contentHash}`,
            idempotencyKey: proof.idempotencyKey,
            projectId: proof.projectId,
            serializedReceipt,
            state: 'complete',
        });

        const projectEvidence = [
            {
                ledger: { records: [projectRecord(proof.contentHash, '{"schemaVersion":1}')] },
                name: 'malformed complete receipt',
            },
            {
                ledger: { records: [projectRecord(`sha256:${'f'.repeat(64)}`, '{}')] },
                name: 'conflicting content hash',
            },
            {
                ledger: { records: [], schemaVersion: 2 },
                name: 'unsupported schema',
            },
        ];
        for (const { ledger, name } of projectEvidence) {
            projectDocument.commandBatchIdempotency = ledger;
            await expect(getVersionedCommandBatchCommitDisposition(proof), name).resolves.toBe('unknown');
            expect(lookup, name).not.toHaveBeenCalled();
        }

        delete projectDocument.commandBatchIdempotency;
        for (const status of ['pending', 'conflict'] as const) {
            lookup.mockResolvedValueOnce({ status });
            await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('unknown');
        }
        lookup.mockRejectedValueOnce(new Error('idempotency repository unavailable'));
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('unknown');
    });

    it('preserves ordered command identity in a valid two-command commit proof', async () => {
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
                    payload: { trackId: 'track-guitar', expectedPan: 0, pan: -0.2 },
                },
                expectedEffect: 'Pan the guitar left.',
                normalizedProjectRevision: baseRevision,
            }).envelope,
            commandId: '22222222-2222-4222-8222-222222222222',
        };
        const batch = compileVersionedCommandBatchEnvelope({
            baseRevision,
            batchId: 'batch-two-command-proof',
            commands: [JSON.stringify(gainCommand), JSON.stringify(panCommand)],
            idempotencyKey: 'client-request-two-command-proof',
            intent: 'Balance vocal and guitar',
            mode: 'commit',
            projectId: 'project-idempotency',
            runId: 'run-two-command-proof',
        });
        const parsed = parseVersionedCommandBatchEnvelope(batch.serialized, batch.authority);
        if (parsed.status === 'invalid') {
            throw new Error(parsed.reason);
        }
        const proof = await getVersionedCommandBatchCommitProof(batch);
        const receipt = JSON.stringify(
            createVerifiedBatchReceipt({
                contentHash: proof.contentHash,
                envelope: parsed.envelope,
                observedBaseRevision: baseRevision,
                resultingRevision: revision(1),
                result: {
                    actions: [
                        {
                            action: {
                                type: 'setTrackGain',
                                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
                            },
                            receipt: createVersionedCommandReceipt({ envelope: parsed.envelope.commands[0]! }),
                        },
                        {
                            action: {
                                type: 'setTrackPan',
                                payload: { trackId: 'track-guitar', expectedPan: 0, pan: -0.2 },
                            },
                            receipt: createVersionedCommandReceipt({ envelope: parsed.envelope.commands[1]! }),
                        },
                    ],
                    status: 'committed',
                },
            })
        );
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'complete', serializedReceipt: receipt }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });

        expect(proof.commands).toEqual([
            { commandId: gainCommand.commandId, operation: 'setTrackGain' },
            { commandId: panCommand.commandId, operation: 'setTrackPan' },
        ]);
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('committed');
        const reversedReceipt = JSON.stringify({
            ...(JSON.parse(receipt) as Record<string, unknown>),
            commandOutcomes: (JSON.parse(receipt) as { commandOutcomes: unknown[] }).commandOutcomes.toReversed(),
        });
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'complete', serializedReceipt: reversedReceipt }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });
        await expect(getVersionedCommandBatchCommitDisposition(proof)).resolves.toBe('unknown');
    });

    it('rejects invalid serialized batches and mismatched authority from commit proof', async () => {
        const batch = compileBatch();

        await expect(
            getVersionedCommandBatchCommitProof({ authority: batch.authority, serialized: 'not-json' })
        ).rejects.toThrow('Command batch commit proof is invalid: Command batch must be valid JSON');
        await expect(
            getVersionedCommandBatchCommitProof({
                authority: { ...batch.authority, projectId: 'other-project' },
                serialized: batch.serialized,
            })
        ).rejects.toThrow('Command batch commit proof is invalid: Command batch exceeds application-issued authority');
    });

    it('discards caller recovery prepared for a project transaction that never commits', async () => {
        rejectInitialProjectCommit = true;
        const promote = vi.fn();
        const discard = vi.fn();
        const batch = compileBatch();
        const proof = await getVersionedCommandBatchCommitProof(batch);
        const pendingCheckpointLookup = vi.fn();
        let projectHead = 'before-project-commit';
        configureAutomergeStoragePort({
            getDoc: () => projectDocument,
            getDocHeads: () => [projectHead],
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
                if (rejectInitialProjectCommit && mutationCount === 0) {
                    throw new Error('initial project commit unavailable');
                }
                const draft = structuredClone(projectDocument);
                changeFn(draft);
                projectDocument = draft;
                mutationCount += 1;
            },
        });
        let dispositionDuringPreparedCommit: ReturnType<typeof getVersionedCommandBatchCommitDisposition> | null = null;

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
            options: {
                onProjectCommitCheckpoint: () => {
                    expect(commandBatchIdempotencyStore.value).toMatchObject({
                        records: [{ state: 'effects-pending' }],
                    });
                    const projectBeforeCommit = projectDocument;
                    projectDocument = {
                        ...projectDocument,
                        commandBatchIdempotency: structuredClone(commandBatchIdempotencyStore.value),
                    };
                    projectHead = 'prepared-project-commit';
                    expect(getProjectCommandBatchIdempotencyCheckpoint(proof)).toMatchObject({
                        status: 'pending',
                    });
                    const serializedReceipt = commandBatchIdempotencyStore.value?.records[0]?.serializedReceipt;
                    if (!serializedReceipt) {
                        throw new Error('The prepared project checkpoint did not include a verified receipt');
                    }
                    pendingCheckpointLookup.mockResolvedValue({ status: 'complete', serializedReceipt });
                    commandBatchIdempotencyPort.setRepository({
                        lookup: pendingCheckpointLookup,
                        claim: () => Promise.resolve({ status: 'claimed' }),
                        complete: () => Promise.resolve(),
                    });
                    dispositionDuringPreparedCommit = getVersionedCommandBatchCommitDisposition(proof);
                    projectDocument = projectBeforeCommit;
                    projectHead = 'before-project-commit';
                    return { promote, discard };
                },
            },
        });

        expect(result).toMatchObject({ status: 'failed', reason: 'initial project commit unavailable' });
        await expect(dispositionDuringPreparedCommit).resolves.toBe('unknown');
        expect(pendingCheckpointLookup).not.toHaveBeenCalled();
        expect(promote).not.toHaveBeenCalled();
        expect(discard).toHaveBeenCalledOnce();
        expect(mutationCount).toBe(0);
        expect(runtimeEffectCount).toBe(0);
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
        const projectCommitProof = await getVersionedCommandBatchCommitProof(batch);
        projectDocument = structuredClone(projectDocument);
        commandBatchIdempotencyStore.hydrate();
        expect(getProjectCommandBatchIdempotencyCheckpoint(projectCommitProof)).toMatchObject({
            status: 'pending',
        });
        const postReloadLookup = vi.fn(() => Promise.resolve({ status: 'missing' as const }));
        commandBatchIdempotencyPort.setRepository({
            lookup: postReloadLookup,
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
        });
        await expect(getVersionedCommandBatchCommitDisposition(projectCommitProof)).resolves.toBe('committed');
        expect(postReloadLookup).not.toHaveBeenCalled();
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

    it('does not run retained effects after the originating project generation changes during lease admission', async () => {
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
                        throw new Error('runtime strip unavailable');
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
        expect(first).toMatchObject({ status: 'committed-with-warning' });
        expect(effectAttempts).toBe(2);

        const lease = Promise.withResolvers<boolean>();
        const leaseStarted = vi.fn();
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: () => {
                leaseStarted();
                return lease.promise;
            },
            release: () => Promise.resolve(),
        });
        const recovery = executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });
        await vi.waitFor(() => expect(leaseStarted).toHaveBeenCalledOnce());
        projectRevisionOverride = JSON.stringify({
            documentIdentityEpoch: 2,
            mutationEpoch: 0,
            documents: [{ docId: 'root', heads: ['project-b'] }],
        });
        lease.resolve(true);

        await expect(recovery).resolves.toMatchObject({
            status: 'ambiguous',
            reason: expect.stringContaining('originating project'),
        });
        expect(effectAttempts).toBe(2);
    });

    it('does not write recovery completion after the originating project generation changes during an effect', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        let effectAttempts = 0;
        const recoveryEffect = Promise.withResolvers<void>();
        const recoveryStarted = vi.fn();
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    const applyRuntimeEffect = async () => {
                        effectAttempts += 1;
                        if (effectAttempts <= 2) {
                            throw new Error('runtime strip unavailable');
                        }
                        recoveryStarted();
                        await recoveryEffect.promise;
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
        expect(first).toMatchObject({ status: 'committed-with-warning' });
        commandBatchIdempotencyPort.setRepository({
            lookup: () => Promise.resolve({ status: 'missing' }),
            claim: () => Promise.resolve({ status: 'claimed' }),
            complete: () => Promise.resolve(),
            tryAcquireRecoveryLease: () => Promise.resolve(true),
            release: () => Promise.resolve(),
        });
        const mutationsBeforeRecovery = mutationCount;

        const recovery = executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            serialized: batch.serialized,
        });
        await vi.waitFor(() => expect(recoveryStarted).toHaveBeenCalledOnce());
        projectRevisionOverride = JSON.stringify({
            documentIdentityEpoch: 2,
            mutationEpoch: 0,
            documents: [{ docId: 'root', heads: ['project-b'] }],
        });
        recoveryEffect.resolve();

        await expect(recovery).resolves.toMatchObject({
            status: 'ambiguous',
            reason: expect.stringContaining('originating project'),
        });
        expect(effectAttempts).toBe(3);
        expect(mutationCount).toBe(mutationsBeforeRecovery);
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

    it('preserves declared manual repair in the durable receipt without exposing reconciliation', async () => {
        clearHandlerRegistry();
        const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        expect(gainStorage.hydrate?.()).toBe(true);
        const reconcile = vi.fn().mockRejectedValue(new Error('manual repair required'));
        commandRuntimeRepairPort.setProvider(vi.fn());
        registerHandlerMap({
            setTrackGain: createHandler({
                execute: () => {
                    gainStorage.set({ value: 0.8 });
                    return {
                        status: 'written',
                        afterCommit: () => Promise.reject(new Error('external effect unavailable')),
                        afterAmbiguousCommit: reconcile,
                        postCommitEffect: { kind: 'external-effect', remediation: 'manual-repair' },
                    };
                },
            }),
        });
        const batch = compileBatch({ batchId: 'batch-manual-repair-effect', runId: 'run-manual-repair-effect' });

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
                pendingEffects: [expect.objectContaining({ kind: 'external-effect', remediation: 'manual-repair' })],
            },
        });
        expect(retry).toMatchObject({
            status: 'ambiguous',
            reason: 'Pending external effect requires manual repair',
        });
        expect(reconcile).toHaveBeenCalledOnce();
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
            receipt: { outcome: 'committed', atomicity: 'atomic', errors: [] },
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
            receipt: { outcome: 'committed', atomicity: 'atomic', errors: [] },
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
