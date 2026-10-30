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

import { commandBatchIdempotencyStore } from '../../stores/commandBatchIdempotencyStore';
import { type ActionHistoryMetadata } from '../actionHistoryMetadataPort';
import { commandBatchExecutionAuthorityPort } from '../commandBatchExecutionAuthorityPort';
import { commandBatchIdempotencyPort } from '../commandBatchIdempotencyPort';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandBatchPreviewPort } from '../commandBatchPreviewPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { commandRuntimeRepairPort } from '../commandRuntimeRepairPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';

import { executeApprovedVersionedCommandBatchEnvelope as executeVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;

const mocks = vi.hoisted(() => ({
    clearSemanticContext: vi.fn(),
    commitUndoEntry: vi.fn(),
    recordAction: vi.fn(),
    recordActionHistoryMetadata: vi.fn<(entry: ActionHistoryMetadata) => string[]>(() => []),
    setSemanticContext: vi.fn(),
}));
vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: { value: null },
    clearSemanticContext: mocks.clearSemanticContext,
    setSemanticContext: mocks.setSemanticContext,
}));
vi.mock('../actionHistoryMetadataPort', () => ({
    actionHistoryMetadataPort: {
        record: mocks.recordActionHistoryMetadata,
        recordBatch: (entries: readonly ActionHistoryMetadata[]) =>
            entries.flatMap((entry) => mocks.recordActionHistoryMetadata(entry)),
    },
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
        idempotencyKey?: string;
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
        idempotencyKey: input.idempotencyKey ?? 'client-request-1',
        intent: 'Set vocal gain',
        mode: 'commit',
        projectId: 'project-idempotency',
        runId: input.runId ?? 'run-idempotency',
    });
}

describe('prepared storage through command batch commits', () => {
    const durableStorageKey = 'sourdaw:command-batch-idempotency:v1';
    let mutationCount: number;
    let projectDocument: Record<string, unknown>;
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
        runtimeEffectCount = 0;
        runtimeGain = 1;
        projectDocument = { trackGain: { value: 1 }, trackPan: { value: 0 }, unrelated: { value: false } };
        const baseProjectDocument = structuredClone(projectDocument);
        const records = new Map<string, { contentHash: string; serializedReceipt?: string }>();
        const recoveryLeases = new Set<string>();
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
                records.set(`${projectId}:${idempotencyKey}`, { contentHash, serializedReceipt });
                return Promise.resolve();
            },
            tryAcquireRecoveryLease: ({ projectId, idempotencyKey }) => {
                const key = `${projectId}:${idempotencyKey}`;
                if (recoveryLeases.has(key)) {
                    return Promise.resolve(false);
                }
                recoveryLeases.add(key);
                return Promise.resolve(true);
            },
            release: ({ projectId, idempotencyKey }) => {
                recoveryLeases.delete(`${projectId}:${idempotencyKey}`);
                return Promise.resolve();
            },
        });
        configureAutomergeStoragePort({
            getDoc: () => projectDocument,
            getSemanticMessage: () => undefined,
            hasDoc: () => true,
            mutateDoc: ({ changeFn }) => {
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

    it.each([false, true])(
        'conditionally consumes a real prepared gain write when late checkpoint is %s',
        async (lateCheckpoint) => {
            const { captureAutomergeStoragePreparationScope } =
                await import('#/infra/store/storage/createAutomergeStorage');
            const { executeAppActionBatch } = await import('../executeAppActionBatch');
            type Port = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;
            const candidates = new WeakMap<object, Record<string, unknown>>();
            const publications: { prepared: boolean; keys: readonly string[]; checkpoint: unknown }[] = [];
            let materialized = 0;
            // This typed port observes storage branch selection. Native actor/CAS proof belongs to the repository tests.
            const port: Port = {
                getDoc: () => projectDocument,
                getDocHeads: () => [`head-${String(mutationCount)}`],
                hasDoc: () => true,
                getSemanticMessage: () => undefined,
                mutateDoc: ({ changeFn }) => {
                    const draft = structuredClone(projectDocument);
                    changeFn(draft);
                    projectDocument = draft;
                    mutationCount++;
                },
                cloneDocForMutation: ({ changeFn }) => {
                    const original = projectDocument;
                    const copied = structuredClone(original);
                    let discarded = false;
                    return {
                        isCurrent: () => !discarded && projectDocument === original,
                        discard: () => {
                            discarded = true;
                        },
                        materialize: () => {
                            changeFn(copied);
                            materialized++;
                            const token = {};
                            candidates.set(token, copied);
                            return {
                                token,
                                isCurrent: () => !discarded && projectDocument === original && candidates.has(token),
                                discard: () => {
                                    discarded = true;
                                    candidates.delete(token);
                                },
                            };
                        },
                    };
                },
                mutateDocValidated: (input) => {
                    let candidate: Record<string, unknown>;
                    if (input.preparedCandidate) {
                        const prepared = candidates.get(input.preparedCandidate);
                        if (!prepared) {
                            throw new Error('Missing actual prepared candidate');
                        }
                        candidate = prepared;
                    } else {
                        candidate = structuredClone(projectDocument);
                        input.changeFn(candidate);
                    }
                    input.validateDocument(candidate);
                    input.beforePublication();
                    publications.push({
                        prepared: input.preparedCandidate !== undefined,
                        keys: input.changedKeys,
                        checkpoint: structuredClone(candidate.commandBatchIdempotency),
                    });
                    projectDocument = candidate;
                    mutationCount++;
                    input.onPublished();
                },
            };
            configureAutomergeStoragePort(port);
            projectDocument = { ...projectDocument, commandBatchIdempotency: { records: [] } };
            commandBatchIdempotencyStore.hydrate();
            flushAutomergeStorageWrites();
            const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
            gainStorage.hydrate?.();
            clearHandlerRegistry();
            registerHandlerMap({
                setTrackGain: createHandler({
                    execute: () => {
                        const original = projectDocument;
                        const preparation = gainStorage.prepareSet?.(captureAutomergeStoragePreparationScope(), {
                            value: 0.8,
                        });
                        if (preparation) {
                            preparation.clone();
                            preparation.materialize();
                            expect(projectDocument).toBe(original);
                            expect(gainStorage.get()).toEqual({ value: 1 });
                            expect(preparation.stage()).toBe(true);
                        } else {
                            // Isolated preview keeps the ordinary private workspace path; actual reuse is asserted below.
                            gainStorage.set({ value: 0.8 });
                        }
                        return {
                            status: 'written',
                            commitValidation: {
                                documentId: 'root',
                                beforeCommit: () => null,
                                release: () => undefined,
                                validateDocument: (document) => {
                                    const gain = document.trackGain;
                                    return typeof gain === 'object' &&
                                        gain !== null &&
                                        'value' in gain &&
                                        gain.value === 0.8
                                        ? null
                                        : 'prepared gain missing';
                                },
                            },
                            afterCommit: () => {
                                runtimeGain = 0.8;
                                runtimeEffectCount++;
                            },
                            afterAmbiguousCommit: () => {
                                const gain = projectDocument.trackGain;
                                if (
                                    typeof gain !== 'object' ||
                                    gain === null ||
                                    !('value' in gain) ||
                                    typeof gain.value !== 'number'
                                ) {
                                    throw new TypeError('Expected committed track gain');
                                }
                                if (runtimeGain !== gain.value) {
                                    runtimeGain = gain.value;
                                    runtimeEffectCount++;
                                }
                            },
                        };
                    },
                }),
            });
            if (lateCheckpoint) {
                const batch = compileBatch({ baseRevision: revision(mutationCount) });
                const result = await executeVersionedCommandBatchEnvelope({
                    authority: batch.authority,
                    serialized: batch.serialized,
                    confirmed: true,
                });
                expect(result.status).toBe('committed');
                // Observe the FIRST actual publication: a later receipt-finalization write cannot mask a dropped checkpoint.
                expect(publications[0]?.checkpoint).toMatchObject({ records: [{ state: 'effects-pending' }] });
                expect(publications[0]?.prepared).toBe(false);
                expect(publications[0]?.keys).toEqual(['trackGain', 'commandBatchIdempotency']);
                expect(projectDocument.commandBatchIdempotency).toMatchObject({ records: [{ state: 'complete' }] });
            } else {
                const result = await executeAppActionBatch([
                    { type: 'setTrackGain', payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 } },
                ]);
                expect(result.status).toBe('committed');
                expect(publications[0]?.prepared).toBe(true);
                expect(publications[0]?.keys).toEqual(['trackGain']);
            }
            expect(materialized).toBe(1);
            expect(projectDocument.trackGain).toEqual({ value: 0.8 });
            expect(runtimeGain).toBe(0.8);
            expect(runtimeEffectCount).toBe(1);
        }
    );
});
