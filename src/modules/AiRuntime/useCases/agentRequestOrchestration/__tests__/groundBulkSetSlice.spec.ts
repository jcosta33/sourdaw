import { beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from '#/infra/logger/appLogger';

import { type AgentRun, type AgentRunBulkSetBatchSchedule } from '../../../models/AgentRun';
import { type ProjectContext } from '../../../models/ProjectContext';
import { type ArbitraryCommandListEvidence } from '../../compileArbitraryCommandList';
import { getProjectContext } from '../../getProjectContext';
import { groundCompiledCommandBatch } from '../../groundCompiledCommandBatch';
import { groundBulkSetSlice } from '../groundBulkSetSlice';
import { readBulkSetSliceEvidence } from '../readBulkSetSliceEvidence';
import { rebaseBulkSetSliceEvidence } from '../rebaseBulkSetSliceEvidence';

const mocks = vi.hoisted(() => ({
    settle: vi.fn(),
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: { warn: vi.fn() } }));
vi.mock('#/modules/CrdtDocument/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/CrdtDocument/useCases')>()),
    settlePendingProjectWritesAndCaptureRevision: mocks.settle,
}));
vi.mock('../../getProjectContext', () => ({ getProjectContext: vi.fn() }));
vi.mock('../../groundCompiledCommandBatch', () => ({ groundCompiledCommandBatch: vi.fn() }));
vi.mock('../readBulkSetSliceEvidence', () => ({ readBulkSetSliceEvidence: vi.fn() }));
vi.mock('../rebaseBulkSetSliceEvidence', () => ({ rebaseBulkSetSliceEvidence: vi.fn() }));

const REQUEST = 'mute every drum track';
const REVISION = 'revision-live';

const context: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    isPlaying: false,
    isRecording: false,
    isLooping: false,
    loopStart: 0,
    loopEnd: 0,
    punchInEnabled: false,
    punchInBeat: 0,
    punchOutBeat: 16,
    metronomeEnabled: false,
    metronomeVolume: 0.5,
    masterGain: 0.8,
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

function createRun(request: string): AgentRun {
    return {
        schemaVersion: 1,
        runId: 'run-1',
        request,
        mode: 'macro',
        phase: 'executing',
        revisions: { created: 'r0', planned: 'r0', approved: 'r0', committed: null },
        scope: { targetIds: [], targetRanges: [], protectedTargetIds: [], protectedRanges: [] },
        grants: {
            allowedOperationPrefixes: [],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: { limits: {}, consumed: {} },
        budgetAttempts: [],
        plan: null,
        decision: null,
        resume: null,
        batches: [],
        receipts: [],
        renders: [],
        analyses: [],
        modelRoute: { requestedRoute: 'legacy-unknown', selectedRouteId: null },
        providerUsage: [],
        errors: [],
        saga: { schemaVersion: 1, steps: [] },
        cancellation: {
            generation: 0,
            requestedAt: null,
            reason: null,
            consumerAcknowledgedAt: null,
            transportAcknowledgedAt: null,
            backendAcknowledgedAt: null,
        },
        committedWork: [],
        retriableWork: [],
        temporaryAssets: [],
        pendingEffectContinuations: [],
        preparedStemImports: [],
        manualResume: { required: false, reason: null, workIds: [], requiredAt: null },
        workLeases: [],
        contextEvidence: null,
        createdAt: 1,
        activeSince: 1,
        updatedAt: 1,
    };
}

function createEvidence(label: string): ArbitraryCommandListEvidence {
    return {
        schemaVersion: 1,
        snapshotRevision: 'revision-planned',
        providerKnownTargetIds: [],
        selectors: [
            {
                itemId: `item-${label}`,
                stableIds: [`track-${label}`],
                excludedIds: [],
                protectedExclusions: [],
                preconditions: [{ stableId: `track-${label}`, fingerprint: `fingerprint-${label}` }],
            },
        ],
        items: [],
        commands: [
            { name: 'muteTrack', arguments: { trackId: `track-${label}-a`, muted: true } },
            { name: 'muteTrack', arguments: { trackId: `track-${label}-b`, muted: true } },
        ],
        creativeAuthorityId: null,
        expandedMidiTransforms: [],
    };
}

type Stored = { serialized: string; evidence: ArbitraryCommandListEvidence };

function createStored(label: string): Stored {
    return { serialized: `serialized-${label}`, evidence: createEvidence(label) };
}

function createSchedule(
    stored: readonly Stored[],
    overrides: Partial<AgentRunBulkSetBatchSchedule> = {}
): AgentRunBulkSetBatchSchedule {
    return {
        schemaVersion: 1,
        kind: 'bulk-set',
        scheduleId: 'schedule-1',
        position: 1,
        total: stored.length,
        totalCommands: stored.length * 2,
        interactionMode: 'apply',
        trustCeiling: null,
        serializedProviderProposal: null,
        requestProtections: {
            request: REQUEST,
            facts: { protectedUnchanged: [], protectedControls: [] },
            resolvedTrackClauses: [],
        },
        slices: stored.map((entry, index) => ({
            position: index + 1,
            commandCount: 2,
            targetIds: [],
            serializedSlice: entry.serialized,
        })),
        ...overrides,
    };
}

function readEvidenceFrom(stored: readonly Stored[]): void {
    vi.mocked(readBulkSetSliceEvidence).mockImplementation(
        (serialized) => stored.find((entry) => entry.serialized === serialized)?.evidence ?? null
    );
}

function rebaseByPassingEvidenceThrough(): void {
    vi.mocked(rebaseBulkSetSliceEvidence).mockImplementation((input) => ({
        status: 'rebased',
        evidence: input.evidence,
    }));
}

const groundedCommands: Extract<ReturnType<typeof groundCompiledCommandBatch>, { status: 'grounded' }> = {
    status: 'grounded',
    nativeLiteralUses: [],
    actions: [],
    actionCommandGraph: undefined,
    requiresConfirmation: true,
    providerKnownTargetIds: undefined,
    matchSelectorPredicates: [],
    providerProposal: null,
    groundingBasis: undefined,
    protectionFacts: { protectedUnchanged: [], protectedControls: [] },
    refinement: undefined,
};

const READ_BACK_REFUSAL = { status: 'rejected', reason: 'its stored plan could not be read back' };

describe('groundBulkSetSlice', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.settle.mockReturnValue(REVISION);
        vi.mocked(getProjectContext).mockReturnValue(context);
        rebaseByPassingEvidenceThrough();
        vi.mocked(groundCompiledCommandBatch).mockReturnValue(groundedCommands);
    });

    describe('request protection binding', () => {
        it('refuses a schedule that holds no request protections', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);

            const result = groundBulkSetSlice(
                createRun(REQUEST),
                createSchedule(stored, { requestProtections: undefined }),
                1
            );

            expect(result).toEqual({
                status: 'rejected',
                reason: 'its original request protection binding is missing or no longer matches',
            });
            expect(groundCompiledCommandBatch).not.toHaveBeenCalled();
        });

        it('refuses protections that were bound to a different request', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);

            const result = groundBulkSetSlice(createRun('a different request'), createSchedule(stored), 1);

            expect(result).toEqual({
                status: 'rejected',
                reason: 'its original request protection binding is missing or no longer matches',
            });
            expect(groundCompiledCommandBatch).not.toHaveBeenCalled();
        });
    });

    describe('reading the stored plan back', () => {
        it('refuses a schedule when one of its slices does not read back', () => {
            const readable = createStored('one');
            const unreadable = createStored('two');
            readEvidenceFrom([readable]);

            const result = groundBulkSetSlice(createRun(REQUEST), createSchedule([readable, unreadable]), 1);

            expect(result).toEqual(READ_BACK_REFUSAL);
            expect(groundCompiledCommandBatch).not.toHaveBeenCalled();
        });

        it('refuses a position past the last slice', () => {
            const stored = [createStored('one'), createStored('two')];
            readEvidenceFrom(stored);

            const result = groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 3);

            expect(result).toEqual(READ_BACK_REFUSAL);
            expect(rebaseBulkSetSliceEvidence).not.toHaveBeenCalled();
        });

        it('refuses a provider proposal that is not JSON and warns once', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);

            const result = groundBulkSetSlice(
                createRun(REQUEST),
                createSchedule(stored, { serializedProviderProposal: 'not json {' }),
                1
            );

            expect(result).toEqual(READ_BACK_REFUSAL);
            expect(logger.warn).toHaveBeenCalledTimes(1);
            expect(groundCompiledCommandBatch).not.toHaveBeenCalled();
        });

        it('refuses a provider proposal that parses but is not a proposal', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);

            const result = groundBulkSetSlice(
                createRun(REQUEST),
                createSchedule(stored, { serializedProviderProposal: '{}' }),
                1
            );

            expect(result).toEqual(READ_BACK_REFUSAL);
            expect(logger.warn).not.toHaveBeenCalled();
        });

        it('grounds with no provider proposal when the schedule stored none', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);

            const result = groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 1);

            expect(vi.mocked(groundCompiledCommandBatch).mock.calls[0]?.[0].providerProposal).toBeNull();
            expect(result.status).toBe('grounded');
            expect(logger.warn).not.toHaveBeenCalled();
        });
    });

    describe('rebasing and grounding refusals', () => {
        it('returns a rebase refusal as is without grounding', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);
            const refusal = { status: 'rejected', reason: 'a target the batch names changed' } as const;
            vi.mocked(rebaseBulkSetSliceEvidence).mockReturnValue(refusal);

            const result = groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 1);

            expect(result).toBe(refusal);
            expect(groundCompiledCommandBatch).not.toHaveBeenCalled();
        });

        it('reports the rejection reason of a grounding refusal', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);
            vi.mocked(groundCompiledCommandBatch).mockReturnValue({
                status: 'rejected',
                rejectionReason: 'Provider action rejected: track is protected',
            });

            const result = groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 1);

            expect(result).toEqual({ status: 'rejected', reason: 'Provider action rejected: track is protected' });
        });

        it('reports the clarification reason when grounding asks a question', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);
            vi.mocked(groundCompiledCommandBatch).mockReturnValue({
                status: 'clarify',
                planningOutcome: { kind: 'clarify', reason: 'which drum track did you mean', questions: ['Which?'] },
            });

            const result = groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 1);

            expect(result).toEqual({ status: 'rejected', reason: 'which drum track did you mean' });
        });

        it('reports that a batch grounding to no action no longer grounds', () => {
            const stored = [createStored('one')];
            readEvidenceFrom(stored);
            vi.mocked(groundCompiledCommandBatch).mockReturnValue({ status: 'empty' });

            const result = groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 1);

            expect(result).toEqual({ status: 'rejected', reason: 'it no longer grounds to any executable action' });
        });
    });

    describe('rebasing a later slice', () => {
        it('hands the rebase the commands of the earlier slices only, and every recorded fingerprint', () => {
            const stored = [createStored('one'), createStored('two'), createStored('three')];
            readEvidenceFrom(stored);

            groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 3);

            const input = vi.mocked(rebaseBulkSetSliceEvidence).mock.calls[0]?.[0];
            expect(input?.evidence).toBe(stored[2]?.evidence);
            expect(input?.revision).toBe(REVISION);
            expect(input?.context).toBe(context);
            expect(input?.earlierCommands).toEqual(stored.slice(0, 2).flatMap((entry) => entry.evidence.commands));
            expect(input?.earlierCommands).toHaveLength(4);
            expect(input?.recordedFingerprints).toEqual(
                new Map([
                    ['track-one', 'fingerprint-one'],
                    ['track-two', 'fingerprint-two'],
                    ['track-three', 'fingerprint-three'],
                ])
            );
        });

        it('hands the first slice no earlier commands', () => {
            const stored = [createStored('one'), createStored('two')];
            readEvidenceFrom(stored);

            groundBulkSetSlice(createRun(REQUEST), createSchedule(stored), 1);

            expect(vi.mocked(rebaseBulkSetSliceEvidence).mock.calls[0]?.[0].earlierCommands).toEqual([]);
        });
    });

    describe('a grounded slice', () => {
        it('returns the live context and revision with the composed intent', () => {
            const stored = [createStored('one'), createStored('two')];
            readEvidenceFrom(stored);
            const schedule = createSchedule(stored);
            const run = createRun(REQUEST);

            const result = groundBulkSetSlice(run, schedule, 2);

            if (result.status !== 'grounded') {
                throw new Error('Expected the slice to ground.');
            }
            expect(result.context).toBe(context);
            expect(result.revision).toBe(REVISION);
            expect(result.result.rawText).toBe(run.request);
            expect(result.result.executionMode).toBe('atomic');
            expect(result.result.batchSchedule?.position).toBe(2);
            expect(result.result.batchSchedule?.slices).toEqual(schedule.slices);
            expect(result.result.batchSchedule?.slices).not.toBe(schedule.slices);
        });
    });
});
