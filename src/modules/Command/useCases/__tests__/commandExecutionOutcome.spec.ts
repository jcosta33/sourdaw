import { from } from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    createAutomergeStoragePreview,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import {
    getArrangementHandlers,
    getTrackStoreState,
    setArrangementEventBus,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { type ActionHandler, type AppAction, type HandlerAfterCommit } from '#/utils/handlerContract';

import { clearHandlerRegistry, registerHandlerMap } from '../../stores/handlerRegistry';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandBatchPreviewPort } from '../commandBatchPreviewPort';
import { commandProjectDivergencePort } from '../commandProjectDivergencePort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { commandTrackDefaultsPort } from '../commandTrackDefaultsPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeAppActionBatch } from '../executeAppActionBatch';
import { type executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';
import { parseStoredVerifiedBatchReceipt } from '../parseStoredVerifiedBatchReceipt';
import { type previewVersionedCommandBatchEnvelope } from '../previewVersionedCommandBatchEnvelope';
import { productionBriefAdmissionPort } from '../productionBriefAdmissionPort';

import { executeApprovedVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

type SetEditingToolAction = Extract<AppAction, { type: 'setEditingTool' }>;
type SetSnapValueAction = Extract<AppAction, { type: 'setSnapValue' }>;
type SetPlaybackAction = Extract<AppAction, { type: 'setPlayback' }>;
type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;
type AddTrackAction = Extract<AppAction, { type: 'addTrack' }>;
type IsolatedPreviewGainHandler = Extract<ActionHandler<SetTrackGainAction>, { previewExecution: 'isolated-project' }>;

const mocks = vi.hoisted(() => ({
    setSemanticContext: vi.fn(),
    clearSemanticContext: vi.fn(),
    branchStore: { value: null, subscribe: vi.fn(() => vi.fn()) },
    actionHistoryStore: { value: null, subscribe: vi.fn(() => vi.fn()) },
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
    agentProjectRepairStateStore: { value: null },
    setSemanticContext: mocks.setSemanticContext,
    clearSemanticContext: mocks.clearSemanticContext,
    branchStore: mocks.branchStore,
    actionHistoryStore: mocks.actionHistoryStore,
    MAIN_BRANCH_ID: 'main',
}));

/**
 * The three terminal vocabularies this module publishes. Each alias reads the
 * live callable rather than a hand-written type, so a status added, removed or
 * renamed in the use case reaches the assertions below instead of drifting past
 * a copy of the union.
 */
type BatchStatus = Awaited<ReturnType<typeof executeAppActionBatch>>['status'];
type PreviewStatus = ReturnType<typeof previewVersionedCommandBatchEnvelope>['status'];
type SagaStatus = Awaited<ReturnType<typeof executeVersionedCommandBatchEnvelope>>['status'];

/** Every literal `parseStoredVerifiedBatchReceipt` accepts as a persisted receipt outcome. */
const RECEIPT_OUTCOMES = [
    'committed',
    'committed-with-warning',
    'executed',
    'executed-with-warning',
    'no-op',
    'ambiguous',
    'rejected',
    'conflicted',
    'cancelled',
    'failed',
    'partially-committed',
    'verification-failed',
] as const;

const RECEIPT_CONTENT_HASH = `sha256:${'a'.repeat(64)}`;
const RECEIPT_COMMAND = { commandId: 'command-1', operation: 'setTrackGain' };
const RECEIPT_REVISION = {
    normalizedRevision: 'revision-1',
    documentIdentityEpoch: null,
    mutationEpoch: null,
    documents: [],
};

/**
 * A receipt is rejected both for an unknown outcome word and for an outcome that
 * disagrees with its command outcomes, so the fixture supplies the consistent
 * shape each outcome demands. What is left varying between rows is the word.
 */
function receiptShapeFor(outcome: string) {
    if (outcome === 'partially-committed') {
        return {
            atomicity: 'durable-atomic-with-non-atomic-effects',
            commandOutcome: 'committed',
            pendingEffects: [
                {
                    ...RECEIPT_COMMAND,
                    kind: 'external-effect',
                    reason: 'The follow-up render has not completed.',
                    remediation: 'reconcile',
                    state: 'pending',
                },
            ],
        };
    }
    const commandOutcomeByOutcome: Record<string, string> = {
        committed: 'committed',
        'committed-with-warning': 'committed',
        executed: 'executed',
        'executed-with-warning': 'executed',
        'no-op': 'no-op',
        ambiguous: 'unknown',
    };
    return {
        atomicity: 'atomic',
        commandOutcome: commandOutcomeByOutcome[outcome] ?? 'not-applied',
        pendingEffects: undefined,
    };
}

function parseReceiptWithOutcome(outcome: string) {
    const shape = receiptShapeFor(outcome);
    const serializedReceipt = JSON.stringify({
        schemaVersion: 2,
        contentHash: RECEIPT_CONTENT_HASH,
        runId: 'run-1',
        batchId: 'batch-1',
        outcome,
        atomicity: shape.atomicity,
        base: RECEIPT_REVISION,
        observedBase: RECEIPT_REVISION,
        resulting: RECEIPT_REVISION,
        commandOutcomes: [
            { ...RECEIPT_COMMAND, outcome: shape.commandOutcome, affectedIds: [], compensationAvailable: false },
        ],
        affectedIds: [],
        createdBindings: [],
        warnings: [],
        errors: [],
        ...(shape.pendingEffects ? { pendingEffects: shape.pendingEffects } : {}),
        links: { render: [], analysis: [] },
        compensation: { available: false, commandIds: [] },
        semanticDiff: null,
        modelSummary: 'A stored batch receipt.',
    });
    return parseStoredVerifiedBatchReceipt({
        baseRevision: RECEIPT_REVISION.normalizedRevision,
        batchId: 'batch-1',
        commands: [RECEIPT_COMMAND],
        contentHash: RECEIPT_CONTENT_HASH,
        runId: 'run-1',
        serializedReceipt,
    });
}

function createHandler<Action extends AppAction>(input: {
    execute: ActionHandler<Action>['execute'];
    describe?: ActionHandler<Action>['describe'];
    executionKind?: ActionHandler<Action>['executionKind'];
    isNoop?: ActionHandler<Action>['isNoop'];
    requiresAbortCompensation?: boolean;
    validate?: ActionHandler<Action>['validate'];
    undoable?: boolean;
}): ActionHandler<Action> {
    return {
        execute: input.execute,
        describe: input.describe ?? ((action) => ({ label: 'Batch action', inverseAction: action })),
        executionKind: input.executionKind,
        isNoop: input.isNoop,
        requiresAbortCompensation: input.requiresAbortCompensation,
        validate: input.validate ?? (() => true),
        undoable: input.undoable ?? true,
    };
}

describe('command execution outcome vocabulary', () => {
    describe('published terminal statuses', () => {
        it('pins the canonical batch terminal statuses', () => {
            expectTypeOf<BatchStatus>().toEqualTypeOf<
                | 'committed'
                | 'committed-with-warning'
                | 'executed'
                | 'executed-with-warning'
                | 'no-op'
                | 'ambiguous'
                | 'rejected'
                | 'conflicted'
                | 'cancelled'
                | 'failed'
            >();
        });

        it('pins the isolated preview terminal statuses', () => {
            expectTypeOf<PreviewStatus>().toEqualTypeOf<'previewed' | 'no-op' | 'rejected' | 'conflicted' | 'failed'>();
        });

        it('pins the saga terminal statuses as the batch vocabulary plus its own two', () => {
            // The saga forwards the preview terminal and the batch terminal
            // unchanged, and adds only `idempotent-replay` of its own.
            expectTypeOf<SagaStatus>().toEqualTypeOf<BatchStatus | PreviewStatus | 'idempotent-replay'>();
            expectTypeOf<SagaStatus>().toEqualTypeOf<
                | 'committed'
                | 'committed-with-warning'
                | 'executed'
                | 'executed-with-warning'
                | 'no-op'
                | 'ambiguous'
                | 'rejected'
                | 'conflicted'
                | 'cancelled'
                | 'failed'
                | 'previewed'
                | 'idempotent-replay'
            >();
        });

        it('accepts exactly the persisted receipt outcome vocabulary', () => {
            for (const outcome of RECEIPT_OUTCOMES) {
                expect(parseReceiptWithOutcome(outcome), outcome).toMatchObject({ outcome });
            }
            // `stale` carries the same not-applied shape every refused outcome
            // carries, so the word itself is what the parser turns away.
            expect(parseReceiptWithOutcome('stale')).toBeNull();
        });
    });

    describe('batch terminal statuses observed through the registry', () => {
        beforeEach(() => {
            vi.clearAllMocks();
            clearHandlerRegistry();
            configureAutomergeStoragePort(null);
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        });

        afterEach(() => {
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
            commandTrackDefaultsPort.setTrackColorProvider(null);
            clearHandlerRegistry();
        });

        it('commits a transactional production handler batch', async () => {
            const previousTracks = trackStore.value ? structuredClone(trackStore.value) : null;
            setTrackStoreState(structuredClone(defaultTrackState));
            setArrangementEventBus({ emit: async () => undefined });
            registerHandlerMap(getArrangementHandlers());
            const addTrack: AddTrackAction = {
                type: 'addTrack',
                payload: { id: 'track-committed', name: 'Committed', kind: 'audio', withoutDefaultDevice: true },
            };

            try {
                const result = await executeAppActionBatch([addTrack], { groupId: 'batch-committed' });

                expect(result.status).toBe('committed');
                expect(getTrackStoreState()?.tracks.map((track) => track.id)).toEqual(['track-committed']);
            } finally {
                if (previousTracks) {
                    setTrackStoreState(previousTracks);
                }
            }
        });

        it('commits with a warning when a post-commit effect and its reconciliation both fail', async () => {
            const afterCommit = vi.fn<HandlerAfterCommit>(() =>
                Promise.reject(new Error('section render unavailable'))
            );
            const afterAmbiguousCommit = vi.fn<HandlerAfterCommit>(() =>
                Promise.reject(new Error('runtime strip unavailable'))
            );
            registerHandlerMap({
                setEditingTool: createHandler<SetEditingToolAction>({
                    execute: () => ({ status: 'written', afterCommit, afterAmbiguousCommit }),
                }),
            });

            const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

            expect(result).toMatchObject({
                status: 'committed-with-warning',
                warning:
                    'setEditingTool post-commit effect failed: section render unavailable; runtime reconciliation failed: runtime strip unavailable',
            });
            expect(afterCommit).toHaveBeenCalledOnce();
            expect(afterAmbiguousCommit).toHaveBeenCalledOnce();
        });

        it('executes a singleton runtime-kind handler outside project history', async () => {
            const execute = vi.fn(() => ({ status: 'written' as const }));
            registerHandlerMap({
                setPlayback: createHandler<SetPlaybackAction>({
                    execute,
                    describe: () => ({ label: 'Start playback' }),
                    executionKind: 'runtime',
                    undoable: false,
                }),
            });

            const result = await executeAppActionBatch([{ type: 'setPlayback', payload: { playing: true } }]);

            expect(result).toMatchObject({
                status: 'executed',
                actions: [{ action: { type: 'setPlayback', payload: { playing: true } }, label: 'Start playback' }],
            });
            expect(execute).toHaveBeenCalledOnce();
        });

        it('executes with a warning when a runtime follow-up effect fails', async () => {
            const afterRuntimeExecution = vi.fn<HandlerAfterCommit>(() =>
                Promise.reject(new Error('transport event unavailable'))
            );
            registerHandlerMap({
                setPlayback: createHandler<SetPlaybackAction>({
                    execute: () => ({ status: 'written', afterRuntimeExecution }),
                    executionKind: 'runtime',
                    undoable: false,
                }),
            });

            const result = await executeAppActionBatch([{ type: 'setPlayback', payload: { playing: true } }]);

            expect(result).toMatchObject({
                status: 'executed-with-warning',
                warning: 'setPlayback follow-up effect failed: transport event unavailable',
            });
            expect(afterRuntimeExecution).toHaveBeenCalledOnce();
        });

        it('reports a no-op without executing the handler', async () => {
            const execute = vi.fn();
            registerHandlerMap({
                setEditingTool: createHandler<SetEditingToolAction>({ execute, isNoop: () => true }),
            });

            const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

            expect(result).toEqual({ status: 'no-op', actions: [] });
            expect(execute).not.toHaveBeenCalled();
        });

        it('rejects an action type no handler is registered for', async () => {
            const result = await executeAppActionBatch([{ type: 'setSnapValue', payload: { value: 0.5 } }]);

            expect(result).toEqual({
                status: 'rejected',
                reason: 'No registered handler for action: setSnapValue',
                actions: [],
            });
        });

        it('reports a conflict when a handler refuses to write', async () => {
            registerHandlerMap({
                setEditingTool: createHandler<SetEditingToolAction>({
                    execute: () => ({ status: 'conflict' }),
                }),
            });

            const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

            expect(result).toEqual({
                status: 'conflicted',
                reason: 'Action conflicts with current project state: setEditingTool',
                actions: [],
            });
        });

        it('cancels a batch whose execution authority is revoked after admission', async () => {
            const execute = vi.fn();
            const shouldExecute = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
            registerHandlerMap({
                setEditingTool: createHandler<SetEditingToolAction>({ execute }),
            });

            const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }], {
                shouldExecute,
            });

            expect(result).toEqual({
                status: 'cancelled',
                reason: 'Batch execution authority was revoked',
                actions: [],
            });
        });

        it('fails a batch whose handler throws', async () => {
            registerHandlerMap({
                setEditingTool: createHandler<SetEditingToolAction>({
                    // The handler wrote nothing before throwing, so it declares no
                    // abort compensation. What the batch reports is then the
                    // handler's own failure, not a compensation attempt on top.
                    describe: () => ({ label: 'Set editing tool', inverseAction: null }),
                    execute: () => {
                        throw new Error('editing tool store unavailable');
                    },
                    requiresAbortCompensation: false,
                }),
            });

            const result = await executeAppActionBatch([{ type: 'setEditingTool', payload: { tool: 'marquee' } }]);

            expect(result).toEqual({
                status: 'failed',
                reason: 'editing tool store unavailable',
                actions: [],
            });
        });

        it('reports an ambiguous terminal when the storage transaction commits before a later document fails', async () => {
            const documents: Record<string, Record<string, unknown>> = {
                first: { editingTool: { tool: 'select' } },
                second: { snapValue: { value: 1 } },
            };
            configureAutomergeStoragePort({
                getDoc: (docId) => documents[docId],
                getSemanticMessage: () => undefined,
                hasDoc: (docId) => docId in documents,
                mutateDoc: ({ docId, changeFn }) => {
                    if (docId === 'second') {
                        throw new Error('second document failed');
                    }
                    changeFn(documents[docId] ?? {});
                },
            });
            const editingToolStorage = createAutomergeStorage<{ tool: string }>('first', 'editingTool');
            const snapValueStorage = createAutomergeStorage<{ value: number }>('second', 'snapValue');
            expect(editingToolStorage.hydrate?.()).toBe(true);
            expect(snapValueStorage.hydrate?.()).toBe(true);
            registerHandlerMap({
                setEditingTool: createHandler<SetEditingToolAction>({
                    execute: () => {
                        editingToolStorage.set({ tool: 'marquee' });
                        return {
                            status: 'written',
                            afterCommit: () => undefined,
                            afterAmbiguousCommit: () => undefined,
                        };
                    },
                }),
                setSnapValue: createHandler<SetSnapValueAction>({
                    execute: () => {
                        snapValueStorage.set({ value: 0.5 });
                        return {
                            status: 'written',
                            afterCommit: () => undefined,
                            afterAmbiguousCommit: () => undefined,
                        };
                    },
                }),
            });

            const result = await executeAppActionBatch([
                { type: 'setEditingTool', payload: { tool: 'marquee' } },
                { type: 'setSnapValue', payload: { value: 0.5 } },
            ]);

            expect(result).toEqual({
                status: 'ambiguous',
                reason: 'Automerge storage transaction committed before a later document failed',
                actions: [],
            });
            // The first document kept the write the commit could not disown; the
            // second never took one. That is the state `ambiguous` names.
            expect(documents.first).toEqual({ editingTool: { tool: 'marquee' } });
            expect(documents.second).toEqual({ snapValue: { value: 1 } });
        });
    });

    describe('saga terminal statuses observed through the envelope', () => {
        const BASE_REVISION = 'revision-saga-0';
        let projectDocument: Record<string, unknown>;
        let projectRevision: string;

        function compileGainBatch(mode: 'commit' | 'preview') {
            const action: SetTrackGainAction = {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            };
            const command = {
                ...createExecutionCommandEnvelope({
                    action,
                    expectedEffect: 'Set the vocal gain to 0.8.',
                    normalizedProjectRevision: BASE_REVISION,
                }).envelope,
                commandId: '11111111-1111-4111-8111-111111111111',
            };
            return compileVersionedCommandBatchEnvelope({
                baseRevision: BASE_REVISION,
                batchId: `batch-saga-${mode}`,
                commands: [JSON.stringify(command)],
                intent: 'Set vocal gain',
                mode,
                projectId: 'project-saga',
                runId: `run-saga-${mode}`,
            });
        }

        function registerGainHandler(execute: IsolatedPreviewGainHandler['execute']): void {
            registerHandlerMap({
                setTrackGain: {
                    canReapplyAfterDivergence: () => true,
                    describe: () => ({
                        label: 'Set vocal gain',
                        inverseAction: {
                            type: 'setTrackGain',
                            payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                        },
                    }),
                    execute,
                    previewExecution: 'isolated-project',
                    undoable: true,
                    validate: () => true,
                },
            });
        }

        beforeEach(() => {
            vi.clearAllMocks();
            clearHandlerRegistry();
            projectDocument = { trackGain: { value: 1 } };
            projectRevision = BASE_REVISION;
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
            commandBatchPreviewPort.setProvider(() => {
                const preview = createAutomergeStoragePreview(new Map([['root', from(projectDocument)]]));
                return {
                    getProjectDocument: () => preview.getDocument('root') ?? {},
                    release: preview.release,
                    scope: preview.scope,
                };
            });
            commandBatchPreflightPort.setProvider(() => ({
                audioGraphValid: true,
                availableAssetHashes: [],
                availableAudioBufferIds: [],
                lockedRanges: [],
                projectId: 'project-saga',
                projectInvariantsValid: true,
                targetFingerprints: { 'track-vocal': 'track:track-vocal' },
            }));
            commandProjectRevisionPort.setProvider(() => projectRevision);
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        });

        afterEach(() => {
            flushAutomergeStorageWrites();
            configureAutomergeStoragePort(null);
            commandBatchPreviewPort.setProvider(null);
            commandBatchPreflightPort.setProvider(null);
            commandProjectRevisionPort.setProvider(null);
            commandProjectDivergencePort.setProvider(null);
            productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
            clearHandlerRegistry();
        });

        it('previews an isolated batch without writing live project truth', async () => {
            const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
            expect(gainStorage.hydrate?.()).toBe(true);
            registerGainHandler(() => {
                gainStorage.set({ value: 0.8 });
                return { status: 'written' };
            });
            const batch = compileGainBatch('preview');

            const result = await executeApprovedVersionedCommandBatchEnvelope({
                authority: batch.authority,
                serialized: batch.serialized,
            });

            expect(result.status, JSON.stringify(result)).toBe('previewed');
            expect(projectDocument).toEqual({ trackGain: { value: 1 } });
        });

        it('records a partially-committed receipt when a committed batch leaves an external effect pending', async () => {
            const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
            expect(gainStorage.hydrate?.()).toBe(true);
            const pendingEffect: HandlerAfterCommit = () => Promise.reject(new Error('runtime strip unavailable'));
            registerGainHandler(() => {
                gainStorage.set({ value: 0.8 });
                return { status: 'written', afterCommit: pendingEffect, afterAmbiguousCommit: pendingEffect };
            });
            const batch = compileGainBatch('commit');

            const result = await executeApprovedVersionedCommandBatchEnvelope({
                authority: batch.authority,
                confirmed: true,
                serialized: batch.serialized,
            });

            expect(result, JSON.stringify(result)).toMatchObject({
                status: 'committed-with-warning',
                receipt: { outcome: 'partially-committed' },
            });
            expect(projectDocument).toMatchObject({ trackGain: { value: 0.8 } });
        });

        it('conflicts a batch whose base revision is behind live project truth', async () => {
            const gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
            expect(gainStorage.hydrate?.()).toBe(true);
            const execute = vi.fn(() => {
                gainStorage.set({ value: 0.8 });
                return { status: 'written' as const };
            });
            registerGainHandler(execute);
            const batch = compileGainBatch('commit');
            projectRevision = 'revision-saga-1';

            const result = await executeApprovedVersionedCommandBatchEnvelope({
                authority: batch.authority,
                confirmed: true,
                serialized: batch.serialized,
            });

            // AC-059 calls this outcome `stale`; the live vocabulary spells it
            // `conflicted` and carries the staleness in the reason sentence.
            expect(result, JSON.stringify(result)).toMatchObject({
                status: 'conflicted',
                reason: 'Command batch base revision does not match current project state',
                actions: [],
            });
            expect(execute).not.toHaveBeenCalled();
        });
    });
});
