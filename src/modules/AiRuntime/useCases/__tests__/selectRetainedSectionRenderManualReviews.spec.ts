import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    migrateLegacyAppActionToVersionedCommandEnvelope,
    serializeVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type RenderProjectSectionJobSnapshot } from '#/utils/handlerContract';

import { type AgentRunPendingEffect, type AgentRunState } from '../../models/AgentRun';
import { selectRetainedSectionRenderManualReviews } from '../selectRetainedSectionRenderManualReviews';

const artifacts = vi.hoisted(() => ({ getExact: vi.fn() }));
vi.mock('#/modules/AudioRendering/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioRendering/useCases')>()),
    getExactAgentSectionRenderArtifact: artifacts.getExact,
}));

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
            payload: { sectionIds: jobs.map(({ sectionId }) => sectionId), jobs: structuredClone(jobs) },
        },
        expectedEffect: 'Render exact project sections',
        normalizedProjectRevision: 'revision-original',
    });
    return serializeVersionedCommandEnvelope({ ...command, commandId });
}

function createFixture() {
    const commandBatch = compileVersionedCommandBatchEnvelope({
        runId: 'run-review',
        batchId: 'batch-review',
        projectId: 'project-review',
        baseRevision: 'revision-original',
        intent: 'Render the retained review sections',
        commands: [createCommand('command-a', [verse, chorus]), createCommand('command-b', [outro])],
    });
    const effects: AgentRunPendingEffect[] = ['command-a', 'command-b'].map((commandId) => ({
        commandId,
        kind: 'external-effect',
        operation: 'renderProjectSections',
        reason: 'Retained render requires review.',
        remediation: 'manual-repair',
        state: 'pending',
    }));
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

describe('selectRetainedSectionRenderManualReviews', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getAudioRenderingHandlers());
        artifacts.getExact.mockReset();
        artifacts.getExact.mockImplementation(({ job }) => artifactFor(job));
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
