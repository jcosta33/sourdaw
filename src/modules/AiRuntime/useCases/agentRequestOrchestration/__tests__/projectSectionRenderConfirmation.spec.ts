import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVersionedCommandEnvelope, serializeVersionedCommandEnvelope } from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type PendingAppActionConfirmation } from '../../../stores/pendingActionConfirmationStore';
import { projectSectionRenderConfirmation } from '../projectSectionRenderConfirmation';

const mocks = vi.hoisted(() => ({ getArtifacts: vi.fn() }));

vi.mock('#/modules/AudioRendering/useCases', () => ({
    getAgentSectionRenderArtifacts: mocks.getArtifacts,
}));

const JOB = {
    jobId: 'render-verse',
    sectionId: 'section-verse',
    sectionName: 'Verse',
    startBeat: 0,
    endBeat: 16,
    sampleRate: 44_100,
    tailSeconds: 0.5,
};

const EXACT_ARTIFACT = {
    owner: 'agent-section-render',
    retention: 'session',
    ...JOB,
    sourceRevision: 'revision-source',
    renderedAt: 1,
    durationSeconds: 4,
    frameCount: 176_400,
    channelCount: 2,
    byteSize: 1_411_200,
    warnings: [],
};

function createConfirmation(): PendingAppActionConfirmation {
    const action = {
        type: 'renderProjectSections',
        payload: { sectionIds: [JOB.sectionId], jobs: [JOB] },
    } satisfies AppAction;
    return {
        id: 'confirmation-projection',
        runId: 'run-projection',
        prompt: 'Render Verse',
        assistantMessageId: 'assistant-projection',
        actionLabels: ['Render Verse'],
        affectedIds: [JOB.sectionId, JOB.jobId],
        protectedUnchanged: [],
        risk: null,
        executedActions: [
            {
                actionType: 'renderProjectSections',
                label: 'Render Verse',
                executionKind: 'project',
                affectedIds: ['unrelated-id', JOB.sectionId, JOB.jobId],
                outcome: 'committed-with-warning',
            },
        ],
        status: 'failed',
        error: 'Renderer unavailable.',
        followUpProjectRevision: 'revision-source',
        followUpStatus: 'retryable',
        createdAt: 1,
        resolvedAt: 2,
        kind: 'app_actions',
        projectRevision: 'revision-source',
        actions: [action],
        approvalSnapshot: { actions: [action], actionLabels: ['Render Verse'], protectedUnchanged: [] },
        executionMode: 'atomic',
        groupId: 'batch-projection',
        groupLabel: 'Render Verse',
    };
}

function createRenderCommand(action: AppAction, expectedEffect: string) {
    return createVersionedCommandEnvelope({
        action,
        availableDeviceVersions: {},
        expectedEffect,
        normalizedProjectRevision: 'revision-source',
        objectReferences: [],
        parameterUnits: [],
        reason: expectedEffect,
        time: [],
    });
}

describe('projectSectionRenderConfirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('projects an exact artifact as complete', () => {
        mocks.getArtifacts.mockReturnValue([EXACT_ARTIFACT]);

        const projected = projectSectionRenderConfirmation({ confirmation: createConfirmation() });

        expect(projected.incompleteSectionRenders).toBeNull();
        expect(projected.completedSectionRenderJobIds).toEqual(new Set([JOB.jobId]));
        expect(projected.performedSectionRenderJobIds).toEqual(new Set([JOB.jobId]));
        expect(projected.reviewRequiredSectionRenders).toEqual([]);
        expect(projected.executions[0]?.affectedIds).toEqual(['unrelated-id', JOB.sectionId, JOB.jobId]);
    });

    it.each([
        ['jobId', { ...EXACT_ARTIFACT, jobId: 'render-other' }],
        ['sectionId', { ...EXACT_ARTIFACT, sectionId: 'section-other' }],
        ['sectionName', { ...EXACT_ARTIFACT, sectionName: 'Other' }],
        ['startBeat', { ...EXACT_ARTIFACT, startBeat: 1 }],
        ['endBeat', { ...EXACT_ARTIFACT, endBeat: 17 }],
        ['sampleRate', { ...EXACT_ARTIFACT, sampleRate: 48_000 }],
        ['tailSeconds', { ...EXACT_ARTIFACT, tailSeconds: 1 }],
        ['sourceRevision', { ...EXACT_ARTIFACT, sourceRevision: 'revision-other' }],
    ])('keeps the job incomplete when artifact %s differs', (_field, artifact) => {
        mocks.getArtifacts.mockReturnValue([artifact]);

        const projected = projectSectionRenderConfirmation({ confirmation: createConfirmation() });

        expect(projected.incompleteSectionRenders).toEqual({ jobs: [JOB], missingJobIds: [JOB.jobId] });
        expect(projected.completedSectionRenderJobIds).toEqual(new Set());
        expect(projected.executions[0]?.affectedIds).toEqual(['unrelated-id']);
    });

    it('projects an exact warned artifact as present but review-required', () => {
        mocks.getArtifacts.mockReturnValue([{ ...EXACT_ARTIFACT, warnings: ['tail truncated'] }]);

        const projected = projectSectionRenderConfirmation({ confirmation: createConfirmation() });

        expect(projected.incompleteSectionRenders).toBeNull();
        expect(projected.completedSectionRenderJobIds).toEqual(new Set());
        expect(projected.performedSectionRenderJobIds).toEqual(new Set([JOB.jobId]));
        expect(projected.reviewRequiredSectionRenders).toEqual([{ jobId: JOB.jobId, warnings: ['tail truncated'] }]);
        expect(projected.executions[0]?.affectedIds).toEqual(['unrelated-id', JOB.sectionId, JOB.jobId]);
    });

    it('keeps a warned earlier artifact incomplete after another exact job completes', () => {
        const confirmation = createConfirmation();
        const renderAction = confirmation.approvalSnapshot.actions[0];
        if (!renderAction || renderAction.type !== 'renderProjectSections' || !renderAction.payload.jobs) {
            throw new Error('Expected render jobs');
        }
        const secondJob = {
            ...JOB,
            jobId: 'render-chorus',
            sectionId: 'section-chorus',
            sectionName: 'Chorus',
            startBeat: 16,
            endBeat: 32,
        };
        renderAction.payload.jobs.push(secondJob);
        renderAction.payload.sectionIds.push(secondJob.sectionId);
        mocks.getArtifacts.mockReturnValue([
            { ...EXACT_ARTIFACT, warnings: ['tail truncated'] },
            { ...EXACT_ARTIFACT, ...secondJob },
        ]);

        const projected = projectSectionRenderConfirmation({ confirmation });

        expect(projected.incompleteSectionRenders).toBeNull();
        expect(projected.completedSectionRenderJobIds).toEqual(new Set([secondJob.jobId]));
        expect(projected.performedSectionRenderJobIds).toEqual(new Set([JOB.jobId, secondJob.jobId]));
        expect(projected.reviewRequiredSectionRenders).toEqual([{ jobId: JOB.jobId, warnings: ['tail truncated'] }]);
        expect(projected.executions[0]?.affectedIds).toContain(JOB.jobId);
    });

    it('scopes every approved render execution to its own command and jobs', () => {
        const confirmation = createConfirmation();
        const firstAction = confirmation.approvalSnapshot.actions[0];
        if (!firstAction || firstAction.type !== 'renderProjectSections') {
            throw new Error('Expected first render action');
        }
        const secondJob = {
            ...JOB,
            jobId: 'render-chorus',
            sectionId: 'section-chorus',
            sectionName: 'Chorus',
            startBeat: 16,
            endBeat: 32,
        };
        const secondAction = {
            type: 'renderProjectSections',
            payload: { sectionIds: [secondJob.sectionId], jobs: [secondJob] },
        } satisfies AppAction;
        const firstCommand = createRenderCommand(firstAction, 'Render Verse');
        const secondCommand = createRenderCommand(secondAction, 'Render Chorus');
        confirmation.approvalSnapshot.actions = [firstAction, secondAction];
        confirmation.approvalSnapshot.commandEnvelopes = [
            serializeVersionedCommandEnvelope(firstCommand),
            serializeVersionedCommandEnvelope(secondCommand),
        ];
        confirmation.executedActions = [
            {
                actionType: 'renderProjectSections',
                commandId: firstCommand.commandId,
                commandSchemaVersion: firstCommand.schemaVersion,
                label: 'Render Verse',
                executionKind: 'project',
                affectedIds: ['verse-execution-id', JOB.sectionId, JOB.jobId, secondJob.sectionId, secondJob.jobId],
                outcome: 'committed-with-warning',
            },
            {
                actionType: 'renderProjectSections',
                commandId: secondCommand.commandId,
                commandSchemaVersion: secondCommand.schemaVersion,
                label: 'Render Chorus',
                executionKind: 'project',
                affectedIds: ['chorus-execution-id', JOB.sectionId, JOB.jobId, secondJob.sectionId, secondJob.jobId],
                outcome: 'committed-with-warning',
            },
        ];
        mocks.getArtifacts.mockReturnValue([EXACT_ARTIFACT, { ...EXACT_ARTIFACT, ...secondJob }]);

        const projected = projectSectionRenderConfirmation({ confirmation });

        expect(projected.approvedSectionRenderJobs).toEqual([JOB, secondJob]);
        expect(projected.executions[0]?.affectedIds).toEqual(['verse-execution-id', JOB.sectionId, JOB.jobId]);
        expect(projected.executions[1]?.affectedIds).toEqual([
            'chorus-execution-id',
            secondJob.sectionId,
            secondJob.jobId,
        ]);
        expect(projected.completedSectionRenderJobIds).toEqual(new Set([JOB.jobId, secondJob.jobId]));
        expect(projected.incompleteSectionRenders).toBeNull();

        confirmation.executedActions.reverse();
        const reordered = projectSectionRenderConfirmation({ confirmation });
        expect(reordered.executions[0]?.affectedIds).toEqual([
            'chorus-execution-id',
            secondJob.sectionId,
            secondJob.jobId,
        ]);
        expect(reordered.executions[1]?.affectedIds).toEqual(['verse-execution-id', JOB.sectionId, JOB.jobId]);
    });

    it('keeps an ambiguous duplicate artifact incomplete', () => {
        mocks.getArtifacts.mockReturnValue([EXACT_ARTIFACT, { ...EXACT_ARTIFACT, renderedAt: 2 }]);

        const projected = projectSectionRenderConfirmation({ confirmation: createConfirmation() });

        expect(projected.incompleteSectionRenders).toEqual({ jobs: [JOB], missingJobIds: [JOB.jobId] });
        expect(projected.performedSectionRenderJobIds).toEqual(new Set());
    });
});
