import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    parseVersionedCommandBatchEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { type AgentRunPendingEffect, type AgentRunState } from '../../models/AgentRun';
import { selectRetainedSectionRenderManualReviews } from '../selectRetainedSectionRenderManualReviews';

const artifacts = vi.hoisted(() => ({ getExact: vi.fn() }));
const commandParsing = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock('#/modules/AudioRendering/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioRendering/useCases')>()),
    getExactAgentSectionRenderArtifact: artifacts.getExact,
}));
vi.mock('#/modules/Command/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Command/useCases')>();
    commandParsing.parse.mockImplementation(actual.parseVersionedCommandBatchEnvelope);
    return { ...actual, parseVersionedCommandBatchEnvelope: commandParsing.parse };
});

const verse: RenderProjectSectionJobSnapshot = {
    jobId: 'job-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 48_000,
    tailSeconds: 1,
};
const chorus: RenderProjectSectionJobSnapshot = {
    jobId: 'job-chorus',
    sectionId: 'section-chorus',
    sectionName: 'Chorus',
    startBeat: 16,
    endBeat: 32,
    sampleRate: 44_100,
    tailSeconds: 2,
};
const outro: RenderProjectSectionJobSnapshot = {
    jobId: 'job-outro',
    sectionId: 'section-outro',
    sectionName: 'Outro',
    startBeat: 32,
    endBeat: 40,
    sampleRate: 48_000,
    tailSeconds: 0,
};

function createCommand(commandId: string, jobs: readonly RenderProjectSectionJobSnapshot[]): string {
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: {
            type: 'renderProjectSections',
            payload: {
                sectionIds: jobs.map(({ sectionId }) => sectionId),
                jobs: jobs.map((job) => structuredClone(job)),
            },
        },
        expectedEffect: 'Render exact project sections',
        normalizedProjectRevision: 'revision-original',
    });
    return serializeVersionedCommandEnvelope({ ...command, commandId });
}

function createTempoCommand(commandId: string): string {
    const command = migrateLegacyAppActionToVersionedCommandEnvelope({
        action: { type: 'setTempo', payload: { bpm: 121 } },
        expectedEffect: 'Set tempo',
        normalizedProjectRevision: 'revision-original',
    });
    return serializeVersionedCommandEnvelope({ ...command, commandId });
}

function createFixture(input?: {
    commands?: string[];
    effectCommandIds?: string[];
    envelopeRunId?: string;
    envelopeBatchId?: string;
    includeReceipt?: boolean;
}) {
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: input?.envelopeRunId ?? 'run-review',
        batchId: input?.envelopeBatchId ?? 'batch-review',
        projectId: 'project-review',
        baseRevision: 'revision-original',
        intent: 'Render the retained review sections',
        commands: input?.commands ?? [createCommand('command-a', [verse, chorus]), createCommand('command-b', [outro])],
    });
    const effects: AgentRunPendingEffect[] = (input?.effectCommandIds ?? ['command-a', 'command-b']).map(
        (commandId) => ({
            commandId,
            kind: 'external-effect',
            operation: 'renderProjectSections',
            reason: 'Retained render requires review.',
            remediation: 'manual-repair',
            state: 'pending',
        })
    );
    const continuation = {
        batchId: 'batch-review',
        effects,
        receiptIdentity: '1:run-review:batch-review:partially-committed',
        recovery: 'manual-repair' as const,
        serializedBatch: commandBatch.serialized,
        authority: commandBatch.authority,
        lastError: 'Review retained render evidence.',
        sourceRevision: 'revision-original',
    };
    const state: AgentRunState = {
        schemaVersion: 1,
        runs: [
            {
                runId: 'run-review',
                revisions: { committed: 'revision-later' },
                receipts:
                    input?.includeReceipt === false
                        ? []
                        : [
                              {
                                  workId: 'batch-review',
                                  receiptIdentity: continuation.receiptIdentity,
                                  revertGroupId: null,
                                  committedAt: 1,
                              },
                          ],
                pendingEffectContinuations: [continuation],
            } as AgentRunState['runs'][number],
        ],
        pendingEffectRecoveryLedger: [{ ...structuredClone(continuation), runId: 'run-review', checkpoint: 'durable' }],
    };
    return { commandBatch, continuation, state };
}

function artifactFor(job: RenderProjectSectionJobSnapshot) {
    return {
        owner: 'agent-section-render' as const,
        retention: 'session' as const,
        ...job,
        sourceRevision: 'revision-original',
        renderedAt: 1,
        durationSeconds: 1,
        frameCount: job.sampleRate,
        channelCount: 2,
        byteSize: job.sampleRate * 8,
        warnings: job.jobId === 'job-chorus' ? ['tail truncated'] : [],
        buffer: { jobId: job.jobId } as unknown as AudioBuffer,
    };
}

function getFirstParsedJobs(parsed: ReturnType<typeof parseVersionedCommandBatchEnvelope>): unknown[] {
    if (parsed.status === 'invalid') {
        throw new Error(parsed.reason);
    }
    const jobs = parsed.envelope.commands[0]?.arguments.jobs;
    if (!Array.isArray(jobs) || jobs.length === 0) {
        throw new Error('Expected a parsed render job table.');
    }
    return jobs;
}

function getFirstParsedJob(parsed: ReturnType<typeof parseVersionedCommandBatchEnvelope>): Record<string, unknown> {
    const job = getFirstParsedJobs(parsed)[0];
    if (typeof job !== 'object' || job === null || Array.isArray(job)) {
        throw new Error('Expected a parsed render job record.');
    }
    return job;
}

describe('selectRetainedSectionRenderManualReviews', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getAudioRenderingHandlers());
        registerHandlerMap(getTransportHandlers());
        artifacts.getExact.mockReset();
        artifacts.getExact.mockImplementation(({ job }) => artifactFor(job));
        commandParsing.parse.mockClear();
    });

    it('projects one exact aggregate containing every job from every render command', () => {
        const { state } = createFixture();

        const reviews = selectRetainedSectionRenderManualReviews(state);

        expect(reviews).toHaveLength(1);
        expect(reviews[0]?.binding).toEqual({
            runId: 'run-review',
            batchId: 'batch-review',
            receiptIdentity: '1:run-review:batch-review:partially-committed',
            sourceRevision: 'revision-original',
            commands: [
                { commandId: 'command-a', jobs: [verse, chorus] },
                { commandId: 'command-b', jobs: [outro] },
            ],
        });
        expect(
            reviews[0]?.jobs.map(({ commandId, job, availability }) => [commandId, job.jobId, availability])
        ).toEqual([
            ['command-a', 'job-verse', 'available'],
            ['command-a', 'job-chorus', 'available'],
            ['command-b', 'job-outro', 'available'],
        ]);
        expect(artifacts.getExact).toHaveBeenCalledWith({ job: verse, sourceRevision: 'revision-original' });
    });

    it('hides promoted recovery until the matching run receipt is projected', () => {
        const { state, continuation } = createFixture({ includeReceipt: false });

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();

        state.runs[0]!.receipts = [
            {
                workId: continuation.batchId,
                receiptIdentity: continuation.receiptIdentity,
                revertGroupId: null,
                committedAt: 1,
            },
        ];

        expect(selectRetainedSectionRenderManualReviews(state)).toHaveLength(1);
    });

    it('rejects a sole run receipt whose identity differs from the exact durable binding', () => {
        const { state } = createFixture();
        state.runs[0]!.receipts[0]!.receiptIdentity = '1:run-review:batch-review:committed';

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();
    });

    it('rejects a coherent committed-outcome binding before artifact lookup', () => {
        const { state } = createFixture();
        const committedIdentity = '1:run-review:batch-review:committed';
        state.runs[0]!.receipts[0]!.receiptIdentity = committedIdentity;
        state.runs[0]!.pendingEffectContinuations[0]!.receiptIdentity = committedIdentity;
        state.pendingEffectRecoveryLedger![0]!.receiptIdentity = committedIdentity;

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();
    });

    it.each([
        [
            'matching receipts',
            (state: AgentRunState) => {
                state.runs[0]!.receipts.push(structuredClone(state.runs[0]!.receipts[0]!));
            },
        ],
        [
            'matching recovery ledger entries',
            (state: AgentRunState) => {
                state.pendingEffectRecoveryLedger!.push(structuredClone(state.pendingEffectRecoveryLedger![0]!));
            },
        ],
        [
            'run IDs',
            (state: AgentRunState) => {
                state.runs.push(structuredClone(state.runs[0]!));
            },
        ],
        [
            'continuation batch IDs',
            (state: AgentRunState) => {
                state.runs[0]!.pendingEffectContinuations.push(
                    structuredClone(state.runs[0]!.pendingEffectContinuations[0]!)
                );
            },
        ],
    ])('rejects duplicate %s before artifact lookup', (_label, duplicate) => {
        const { state } = createFixture();
        duplicate(state);

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();
    });

    it('looks up artifacts by the continuation source revision rather than the batch base revision', () => {
        const { state } = createFixture();
        state.runs[0]!.pendingEffectContinuations[0]!.sourceRevision = 'revision-finalized';
        state.pendingEffectRecoveryLedger![0]!.sourceRevision = 'revision-finalized';

        expect(selectRetainedSectionRenderManualReviews(state)).toHaveLength(1);
        expect(state.pendingEffectRecoveryLedger![0]!.authority.baseRevision).toBe('revision-original');
        expect(artifacts.getExact).toHaveBeenCalledWith({ job: verse, sourceRevision: 'revision-finalized' });
    });

    it('projects only manual-review render effects when the original batch has a non-render sibling', () => {
        const { state } = createFixture({
            commands: [
                createTempoCommand('command-tempo'),
                createCommand('command-a', [verse, chorus]),
                createCommand('command-b', [outro]),
            ],
        });

        const reviews = selectRetainedSectionRenderManualReviews(state);

        expect(reviews).toHaveLength(1);
        expect(reviews[0]?.binding.commands).toEqual([
            { commandId: 'command-a', jobs: [verse, chorus] },
            { commandId: 'command-b', jobs: [outro] },
        ]);
        expect(reviews[0]?.jobs).toHaveLength(3);
    });

    it('ignores a clean render sibling that has no pending manual-review effect', () => {
        const { state } = createFixture({
            commands: [createCommand('command-clean', [verse, chorus]), createCommand('command-b', [outro])],
            effectCommandIds: ['command-b'],
        });

        const reviews = selectRetainedSectionRenderManualReviews(state);

        expect(reviews).toHaveLength(1);
        expect(reviews[0]?.binding.commands).toEqual([{ commandId: 'command-b', jobs: [outro] }]);
        expect(reviews[0]?.jobs.map(({ job }) => job.jobId)).toEqual(['job-outro']);
    });

    it.each([
        ['run', { envelopeRunId: 'wrong-run' }],
        ['batch', { envelopeBatchId: 'wrong-batch' }],
    ])('rejects a valid envelope bound to the wrong %s before artifact lookup', (_label, input) => {
        const { state } = createFixture(input);

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();
    });

    it.each([
        [
            'within one command',
            () => [
                createCommand('command-a', [verse, { ...chorus, jobId: verse.jobId }]),
                createCommand('command-b', [outro]),
            ],
        ],
        [
            'across commands',
            () => [createCommand('command-a', [verse]), createCommand('command-b', [{ ...outro, jobId: verse.jobId }])],
        ],
    ])('rejects duplicate job IDs %s before artifact lookup', (_label, createCommands) => {
        const { state } = createFixture({ commands: createCommands() });

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();
    });

    it('rejects a non-record persisted render job before artifact lookup', () => {
        const { commandBatch, state } = createFixture();
        const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        getFirstParsedJobs(parsed)[0] = null;
        commandParsing.parse.mockReturnValueOnce(parsed);

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();
    });

    it.each([
        ['jobId type', (job: Record<string, unknown>) => (job.jobId = 1)],
        ['jobId empty', (job: Record<string, unknown>) => (job.jobId = '')],
        ['sectionId type', (job: Record<string, unknown>) => (job.sectionId = 1)],
        ['sectionId empty', (job: Record<string, unknown>) => (job.sectionId = '')],
        ['sectionName type', (job: Record<string, unknown>) => (job.sectionName = 1)],
        ['sectionName empty', (job: Record<string, unknown>) => (job.sectionName = '')],
        ['startBeat type', (job: Record<string, unknown>) => (job.startBeat = '0')],
        ['startBeat nonfinite', (job: Record<string, unknown>) => (job.startBeat = Number.NaN)],
        ['startBeat range', (job: Record<string, unknown>) => (job.startBeat = -1)],
        ['endBeat type', (job: Record<string, unknown>) => (job.endBeat = '16')],
        ['endBeat nonfinite', (job: Record<string, unknown>) => (job.endBeat = Number.POSITIVE_INFINITY)],
        ['endBeat range', (job: Record<string, unknown>) => (job.endBeat = 0)],
        ['sampleRate type', (job: Record<string, unknown>) => (job.sampleRate = '48000')],
        ['sampleRate nonfinite', (job: Record<string, unknown>) => (job.sampleRate = Number.NaN)],
        ['sampleRate range', (job: Record<string, unknown>) => (job.sampleRate = 0)],
        ['tailSeconds type', (job: Record<string, unknown>) => (job.tailSeconds = '1')],
        ['tailSeconds nonfinite', (job: Record<string, unknown>) => (job.tailSeconds = Number.POSITIVE_INFINITY)],
        ['tailSeconds range', (job: Record<string, unknown>) => (job.tailSeconds = -1)],
    ])('rejects malformed persisted render job %s before artifact lookup', (_label, mutate) => {
        const { commandBatch, state } = createFixture();
        const parsed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        mutate(getFirstParsedJob(parsed));
        commandParsing.parse.mockReturnValueOnce(parsed);

        expect(selectRetainedSectionRenderManualReviews(state)).toEqual([]);
        expect(artifacts.getExact).not.toHaveBeenCalled();
    });

    it.each([
        ['duplicate', () => artifacts.getExact.mockReturnValue(null)],
        ['expired', () => artifacts.getExact.mockReturnValue(null)],
        ['evicted', () => artifacts.getExact.mockReturnValue(null)],
        ['later revision', () => artifacts.getExact.mockReturnValue(null)],
        ['job-field mismatch', () => artifacts.getExact.mockReturnValue(null)],
    ])('keeps the exact %s job visible as unavailable without substituting evidence', (_label, arrange) => {
        const { state } = createFixture();
        arrange();

        const reviews = selectRetainedSectionRenderManualReviews(state);

        expect(reviews).toHaveLength(1);
        expect(reviews[0]?.jobs).toHaveLength(3);
        expect(reviews[0]?.jobs.every(({ availability }) => availability === 'unavailable')).toBe(true);
    });

    it.each([
        [
            'prepared checkpoint',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.pendingEffectRecoveryLedger![0]!.checkpoint = 'prepared';
            },
        ],
        [
            'receipt',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.pendingEffectRecoveryLedger![0]!.receiptIdentity = 'wrong-receipt';
            },
        ],
        [
            'serialized batch',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.pendingEffectRecoveryLedger![0]!.serializedBatch += ' ';
            },
        ],
        [
            'authority',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.pendingEffectRecoveryLedger![0]!.authority.baseRevision = 'wrong-revision';
            },
        ],
        [
            'effects',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.pendingEffectRecoveryLedger![0]!.effects[0]!.reason = 'mutated';
            },
        ],
        [
            'source revision',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.pendingEffectRecoveryLedger![0]!.sourceRevision = 'wrong-revision';
            },
        ],
        [
            'recovery',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.pendingEffectRecoveryLedger![0]!.recovery = 'reconcile-batch';
            },
        ],
        [
            'malformed batch',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.runs[0]!.pendingEffectContinuations[0]!.serializedBatch = '{malformed';
                fixture.state.pendingEffectRecoveryLedger![0]!.serializedBatch = '{malformed';
            },
        ],
        [
            'command mismatch',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.runs[0]!.pendingEffectContinuations[0]!.effects[0]!.commandId = 'wrong-command';
                fixture.state.pendingEffectRecoveryLedger![0]!.effects[0]!.commandId = 'wrong-command';
            },
        ],
        [
            'duplicate effect command',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.runs[0]!.pendingEffectContinuations[0]!.effects[1]!.commandId = 'command-a';
                fixture.state.pendingEffectRecoveryLedger![0]!.effects[1]!.commandId = 'command-a';
            },
        ],
        [
            'effect mismatch',
            (fixture: ReturnType<typeof createFixture>) => {
                fixture.state.runs[0]!.pendingEffectContinuations[0]!.effects[0]!.operation = 'setTrackGain';
                fixture.state.pendingEffectRecoveryLedger![0]!.effects[0]!.operation = 'setTrackGain';
            },
        ],
    ])('fails closed when the exact %s binding changes', (_label, mutate) => {
        const fixture = createFixture();
        mutate(fixture);

        expect(selectRetainedSectionRenderManualReviews(fixture.state)).toEqual([]);
    });
});
