import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeVersionedCommandBatchEnvelope } from '../executeVersionedCommandBatchEnvelope';

type SetTrackGainAction = Extract<AppAction, { type: 'setTrackGain' }>;
type SetTrackPanAction = Extract<AppAction, { type: 'setTrackPan' }>;
type RenderProjectSectionsAction = Extract<AppAction, { type: 'renderProjectSections' }>;
type AddMarkerAction = Extract<AppAction, { type: 'addMarker' }>;

const GAIN_COMMAND_ID = '11111111-1111-4111-8111-111111111111';
const PAN_COMMAND_ID = '22222222-2222-4222-8222-222222222222';

const mocks = vi.hoisted(() => ({
    clearSemanticContext: vi.fn(),
    commitUndoEntry: vi.fn(),
    recordAction: vi.fn(),
    recordActionHistoryMetadata: vi.fn(() => []),
    setSemanticContext: vi.fn(),
}));

vi.mock('#/modules/CrdtDocument/stores', () => ({
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

function createHandler<Action extends AppAction>(input: {
    execute: ActionHandler<Action>['execute'];
    describe: ActionHandler<Action>['describe'];
    isNoop?: ActionHandler<Action>['isNoop'];
    validate?: ActionHandler<Action>['validate'];
}): ActionHandler<Action> {
    return {
        execute: input.execute,
        describe: input.describe,
        isNoop: input.isNoop,
        validate: input.validate ?? (() => true),
        undoable: true,
    };
}

function command(input: { action: AppAction; commandId: string; expectedEffect: string }) {
    return {
        ...createExecutionCommandEnvelope({
            action: input.action,
            expectedEffect: input.expectedEffect,
            normalizedProjectRevision: revision(0),
        }).envelope,
        commandId: input.commandId,
    };
}

function compileBatch(
    input: {
        dynamicAffectedTargetIds?: readonly string[];
        protectedTargetIds?: readonly string[];
    } = {}
) {
    const commands = [
        command({
            action: {
                type: 'setTrackGain',
                payload: { trackId: 'track-vocal', gain: 0.8, expectedGain: 1 },
            },
            commandId: GAIN_COMMAND_ID,
            expectedEffect: 'Set the vocal gain to 0.8.',
        }),
        command({
            action: {
                type: 'setTrackPan',
                payload: { trackId: 'track-guitar', pan: -0.2, expectedPan: 0 },
            },
            commandId: PAN_COMMAND_ID,
            expectedEffect: 'Pan the guitar left.',
        }),
    ];
    return compileVersionedCommandBatchEnvelope({
        baseRevision: revision(0),
        batchId: 'batch-receipt',
        commands: commands.map((entry) => JSON.stringify(entry)),
        intent: 'Balance vocal and guitar',
        mode: 'commit',
        projectId: 'project-receipt',
        dynamicEffects: input.dynamicAffectedTargetIds
            ? { affectedTargetIds: [...input.dynamicAffectedTargetIds] }
            : undefined,
        protectedTargetIds: input.protectedTargetIds,
        runId: 'run-receipt',
    });
}

function receiptFrom(result: object) {
    expect(result).toHaveProperty('receipt');
    if (!('receipt' in result)) {
        throw new Error('Expected a verified batch receipt');
    }
    return result.receipt;
}

describe('verified batch receipt', () => {
    let mutationCount: number;
    let projectDocument: Record<string, unknown>;
    let gainStorage: ReturnType<typeof createAutomergeStorage<{ value: number }>>;
    let panStorage: ReturnType<typeof createAutomergeStorage<{ value: number }>>;
    let protectedFingerprintChanged: boolean;
    let rejectPostconditions: boolean;

    function compileArtifactBatch(input: { renderAfterCommit?: () => void } = {}) {
        projectDocument = { markers: { ids: [] }, rendered: { jobIds: [] } };
        const markerStorage = createAutomergeStorage<{ ids: string[] }>('root', 'markers');
        const renderedStorage = createAutomergeStorage<{ jobIds: string[] }>('root', 'rendered');
        expect(markerStorage.hydrate?.()).toBe(true);
        expect(renderedStorage.hydrate?.()).toBe(true);
        const jobs = [
            {
                jobId: 'render-verse',
                sectionId: 'section-verse',
                sectionName: 'Verse',
                startBeat: 0,
                endBeat: 16,
                sampleRate: 48_000,
                tailSeconds: 2,
            },
        ];
        const renderAction: RenderProjectSectionsAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: ['section-verse'], jobs },
        };
        const markerAction: AddMarkerAction = {
            type: 'addMarker',
            payload: { beat: 0, markerId: 'marker-render-start', name: 'Render start' },
        };
        registerHandlerMap({
            addMarker: createHandler<AddMarkerAction>({
                execute: () => markerStorage.set({ ids: ['marker-render-start'] }),
                describe: () => ({
                    label: 'Add render marker',
                    inverseAction: { type: 'removeMarker', payload: { markerId: 'marker-render-start' } },
                }),
            }),
            renderProjectSections: createHandler<RenderProjectSectionsAction>({
                execute: () => {
                    renderedStorage.set({ jobIds: ['render-verse'] });
                    let executionResult;
                    if (input.renderAfterCommit) {
                        executionResult = {
                            status: 'written' as const,
                            afterCommit: input.renderAfterCommit,
                            afterAmbiguousCommit: input.renderAfterCommit,
                        };
                    }
                    return executionResult;
                },
                describe: () => ({
                    label: 'Render Verse',
                    inverseAction: {
                        type: 'removeRenderedProjectSections',
                        payload: { sectionIds: ['section-verse'], jobs },
                    },
                }),
            }),
        });
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-receipt',
            projectInvariantsValid: true,
            targetFingerprints: { 'section-verse': 'section:section-verse' },
        }));
        const markerCommand = {
            ...createExecutionCommandEnvelope({
                action: markerAction,
                expectedEffect: 'Add a render-start marker.',
                normalizedProjectRevision: revision(0),
            }).envelope,
            commandId: GAIN_COMMAND_ID,
        };
        const renderCommand = {
            ...createExecutionCommandEnvelope({
                action: renderAction,
                expectedEffect: 'Render the Verse section.',
                normalizedProjectRevision: revision(0),
            }).envelope,
            commandId: PAN_COMMAND_ID,
        };
        return compileVersionedCommandBatchEnvelope({
            baseRevision: revision(0),
            batchId: 'batch-render-receipt',
            commands: [JSON.stringify(markerCommand), JSON.stringify(renderCommand)],
            intent: 'Render Verse',
            mode: 'commit',
            projectId: 'project-receipt',
            runId: 'run-render-receipt',
        });
    }

    function registerTestHandlers(
        input: {
            gainIsNoop?: boolean;
            panAfterCommit?: () => void;
            panIsNoop?: boolean;
            panValid?: boolean;
        } = {}
    ): void {
        registerHandlerMap({
            setTrackGain: createHandler<SetTrackGainAction>({
                execute: () => gainStorage.set({ value: 0.8 }),
                describe: () => ({
                    label: 'Set vocal gain',
                    inverseAction: {
                        type: 'setTrackGain',
                        payload: { trackId: 'track-vocal', gain: 1, expectedGain: 0.8 },
                    },
                }),
                isNoop: () => input.gainIsNoop === true,
            }),
            setTrackPan: createHandler<SetTrackPanAction>({
                execute: () => {
                    panStorage.set({ value: -0.2 });
                    return input.panAfterCommit
                        ? {
                              status: 'written' as const,
                              afterCommit: input.panAfterCommit,
                              afterAmbiguousCommit: input.panAfterCommit,
                          }
                        : undefined;
                },
                describe: () => ({
                    label: 'Pan guitar left',
                    inverseAction: {
                        type: 'setTrackPan',
                        payload: { trackId: 'track-guitar', pan: 0, expectedPan: -0.2 },
                    },
                }),
                isNoop: () => input.panIsNoop === true,
                validate: () => input.panValid !== false,
            }),
        });
    }

    beforeEach(() => {
        vi.clearAllMocks();
        clearHandlerRegistry();
        mutationCount = 0;
        protectedFingerprintChanged = false;
        rejectPostconditions = false;
        projectDocument = { trackGain: { value: 1 }, trackPan: { value: 0 } };
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
        gainStorage = createAutomergeStorage<{ value: number }>('root', 'trackGain');
        panStorage = createAutomergeStorage<{ value: number }>('root', 'trackPan');
        expect(gainStorage.hydrate?.()).toBe(true);
        expect(panStorage.hydrate?.()).toBe(true);
        commandProjectRevisionPort.setProvider(() => revision(mutationCount));
        commandBatchPreflightPort.setProvider(({ projectDocument: stagedDocument }) => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: 'project-receipt',
            projectInvariantsValid: !(rejectPostconditions && stagedDocument !== undefined),
            targetFingerprints: {
                'automation-lane-hidden': 'automation:automation-lane-hidden',
                'track-guitar': 'track:track-guitar',
                'track-protected':
                    protectedFingerprintChanged && stagedDocument !== undefined
                        ? 'protected:after'
                        : 'protected:before',
                'track-vocal': 'track:track-vocal',
            },
        }));
        registerTestHandlers();
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        clearHandlerRegistry();
    });

    it('returns one machine-readable receipt for the exact atomic Automerge outcome', async () => {
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('committed');
        expect(mutationCount).toBe(1);
        expect(projectDocument).toEqual({ trackGain: { value: 0.8 }, trackPan: { value: -0.2 } });
        expect(receiptFrom(result)).toMatchObject({
            schemaVersion: 1,
            runId: 'run-receipt',
            batchId: 'batch-receipt',
            outcome: 'committed',
            atomicity: 'atomic',
            base: {
                normalizedRevision: revision(0),
                documents: [{ docId: 'root', heads: ['head-0'] }],
            },
            resulting: {
                normalizedRevision: revision(1),
                documents: [{ docId: 'root', heads: ['head-1'] }],
            },
            commandOutcomes: [
                {
                    commandId: GAIN_COMMAND_ID,
                    operation: 'setTrackGain',
                    outcome: 'committed',
                    affectedIds: ['track-vocal'],
                    compensationAvailable: true,
                },
                {
                    commandId: PAN_COMMAND_ID,
                    operation: 'setTrackPan',
                    outcome: 'committed',
                    affectedIds: ['track-guitar'],
                    compensationAvailable: true,
                },
            ],
            affectedIds: ['track-guitar', 'track-vocal'],
            createdBindings: [],
            warnings: [],
            errors: [],
            links: { render: [], analysis: [] },
            compensation: {
                available: true,
                commandIds: [GAIN_COMMAND_ID, PAN_COMMAND_ID],
            },
            semanticDiff: {
                batchId: 'batch-receipt',
                summary: 'Balance vocal and guitar',
            },
            modelSummary: 'Committed 2 commands atomically; 2 targets changed; compensation is available.',
        });
    });

    it('reports a complete no-op without claiming a commit or semantic diff', async () => {
        clearHandlerRegistry();
        registerTestHandlers({ gainIsNoop: true, panIsNoop: true });
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('no-op');
        expect(mutationCount).toBe(0);
        expect(receiptFrom(result)).toMatchObject({
            outcome: 'no-op',
            resulting: { normalizedRevision: revision(0) },
            commandOutcomes: [{ outcome: 'no-op' }, { outcome: 'no-op' }],
            affectedIds: [],
            errors: [],
            semanticDiff: null,
            modelSummary: 'No commands changed project state.',
        });
    });

    it('reports a whole-batch conflict with every command not applied', async () => {
        clearHandlerRegistry();
        registerTestHandlers({ panValid: false });
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('conflicted');
        expect(mutationCount).toBe(0);
        expect(receiptFrom(result)).toMatchObject({
            outcome: 'conflicted',
            commandOutcomes: [{ outcome: 'not-applied' }, { outcome: 'not-applied' }],
            affectedIds: [],
            errors: ['Action conflicts with current project state: setTrackPan'],
            semanticDiff: null,
            modelSummary: 'Batch outcome: conflicted; no project change is reported as successful.',
        });
    });

    it('distinguishes failed postcondition verification from an ordinary conflict', async () => {
        protectedFingerprintChanged = true;
        const batch = compileBatch({ protectedTargetIds: ['track-protected'] });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('conflicted');
        expect(mutationCount).toBe(0);
        expect(projectDocument).toEqual({ trackGain: { value: 1 }, trackPan: { value: 0 } });
        expect(receiptFrom(result)).toMatchObject({
            outcome: 'verification-failed',
            commandOutcomes: [{ outcome: 'not-applied' }, { outcome: 'not-applied' }],
            errors: ['Command batch changed protected target: track-protected'],
            resulting: { normalizedRevision: revision(0) },
            semanticDiff: null,
            modelSummary: 'Verification failed; the project batch was not committed.',
        });
    });

    it('reports cancellation without a hidden committed prefix', async () => {
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
            options: { shouldExecute: () => false },
        });

        expect(result.status).toBe('cancelled');
        expect(mutationCount).toBe(0);
        expect(receiptFrom(result)).toMatchObject({
            outcome: 'cancelled',
            commandOutcomes: [{ outcome: 'not-applied' }, { outcome: 'not-applied' }],
            affectedIds: [],
            errors: ['Batch execution authority was revoked'],
            modelSummary: 'Batch outcome: cancelled; no project change is reported as successful.',
        });
    });

    it('reports a durable commit with a failed non-atomic effect as partial', async () => {
        clearHandlerRegistry();
        registerTestHandlers({
            panAfterCommit: () => {
                throw new Error('audio graph update failed');
            },
        });
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('committed-with-warning');
        expect(mutationCount).toBe(1);
        expect(receiptFrom(result)).toMatchObject({
            outcome: 'partially-committed',
            atomicity: 'durable-atomic-with-non-atomic-effects',
            commandOutcomes: [{ outcome: 'committed' }, { outcome: 'committed' }],
            warnings: [
                'setTrackPan post-commit effect failed: audio graph update failed; runtime reconciliation failed: audio graph update failed',
            ],
            errors: [],
            resulting: { normalizedRevision: revision(1) },
            modelSummary: 'Committed 2 commands atomically, but at least one non-atomic follow-up effect failed.',
        });
    });

    it('reports observer warnings without claiming a partial project commit', async () => {
        mocks.recordActionHistoryMetadata.mockImplementationOnce(() => {
            throw new Error('history observer unavailable');
        });
        const batch = compileBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('committed-with-warning');
        expect(receiptFrom(result)).toMatchObject({
            outcome: 'committed-with-warning',
            atomicity: 'atomic',
            warnings: ['history observer unavailable'],
            modelSummary: 'Committed 2 commands atomically; reporting completed with warnings.',
        });
    });

    it('includes application-owned dynamic targets in the committed affected IDs', async () => {
        const batch = compileBatch({ dynamicAffectedTargetIds: ['automation-lane-hidden'] });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('committed');
        expect(receiptFrom(result)).toMatchObject({
            affectedIds: ['automation-lane-hidden', 'track-guitar', 'track-vocal'],
        });
    });

    it('returns created bindings and render links only for committed commands', async () => {
        clearHandlerRegistry();
        const batch = compileArtifactBatch();

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('committed');
        expect(receiptFrom(result)).toMatchObject({
            createdBindings: [
                {
                    commandId: GAIN_COMMAND_ID,
                    argument: 'markerId',
                    value: 'marker-render-start',
                },
            ],
            links: {
                render: [{ commandId: PAN_COMMAND_ID, jobId: 'render-verse' }],
                analysis: [],
            },
        });
    });

    it('omits planned render links when the render effect fails persistently', async () => {
        clearHandlerRegistry();
        const batch = compileArtifactBatch({
            renderAfterCommit: () => {
                throw new Error('renderer unavailable');
            },
        });

        const result = await executeVersionedCommandBatchEnvelope({
            authority: batch.authority,
            confirmed: true,
            serialized: batch.serialized,
        });

        expect(result.status).toBe('committed-with-warning');
        expect(receiptFrom(result)).toMatchObject({
            outcome: 'partially-committed',
            links: { render: [], analysis: [] },
        });
    });
});
