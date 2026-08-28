import { beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('projectSectionRenderConfirmation', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('projects an exact artifact as complete', () => {
        mocks.getArtifacts.mockReturnValue([EXACT_ARTIFACT]);

        const projected = projectSectionRenderConfirmation({ confirmation: createConfirmation() });

        expect(projected.incompleteSectionRenders).toBeNull();
        expect(projected.completedSectionRenderJobIds).toEqual(new Set([JOB.jobId]));
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
});
