import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

const { resumeSend } = vi.hoisted(() => ({
    resumeSend: vi.fn().mockImplementation(async (_request, options) => {
        options.onResumedRunAdmitted('run-decision-resume-attempt');
        options.onResumedPlanAccepted();
    }),
}));

vi.mock('../sendChatMessage', () => ({ sendChatMessage: resumeSend }));

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunControls } from '../getAgentRunControlProjection';
import { getPlanningProviderSchemaContract } from '../planningProviderSchema';

const grants = {
    allowedOperationPrefixes: ['muteTrack'],
    create: false,
    delete: false,
    routing: false,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: false,
};
const scope = { targetIds: ['bass-1'], targetRanges: [], protectedTargetIds: [], protectedRanges: [] };

function createPendingDecision(input?: {
    budgets?: { limits: Record<string, number>; consumed: Record<string, number> };
    schemaIdentity?: string;
}): void {
    const revision = captureProjectRevision();
    const budgets = input?.budgets ?? { limits: {}, consumed: {} };
    agentRunLifecycle.create({
        runId: 'run-decision-resume',
        request: 'Mute Bass.',
        mode: 'plan',
        createdRevision: revision,
        scope,
        grants,
        budgets,
    });
    agentRunLifecycle.recordDecision({
        runId: 'run-decision-resume',
        decision: {
            decisionId: 'decision-mute',
            capabilitySchemaIdentity: input?.schemaIdentity ?? getPlanningProviderSchemaContract().identity,
            proposalIdentity: 'proposal-mute',
            budgets,
            revision,
            scope,
            grants,
            alternatives: [{ id: 'mute', label: 'Mute Bass', changesAuthority: false }],
            reason: 'Choose the bounded interpretation.',
            selectedAlternativeId: null,
            resumeAttemptId: null,
        },
    });
    agentRunLifecycle.requireManualResume({
        runId: 'run-decision-resume',
        reason: 'Choose the bounded interpretation.',
        workIds: [],
    });
}

describe('resumeAgentRunDecision', () => {
    afterEach(() => {
        agentRunLifecycle.clear();
        resumeSend.mockClear();
    });

    it('exposes and consumes one hydrated structured decision without parsing prose', async () => {
        createPendingDecision();
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(true);
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual({
            status: 'resumed',
            sourceRunId: 'run-decision-resume',
            runId: 'run-decision-resume-attempt',
            decisionId: 'decision-mute',
            selectedAlternativeId: 'mute',
        });
        expect(resumeSend).toHaveBeenCalledWith(
            'Mute Bass.',
            expect.objectContaining({
                mode: 'plan',
                scope,
                grants,
                budgets: { limits: {}, consumed: {} },
                resume: expect.objectContaining({
                    sourceRunId: 'run-decision-resume',
                    decisionId: 'decision-mute',
                    selectedAlternativeId: 'mute',
                    selectedAlternative: { id: 'mute', label: 'Mute Bass', changesAuthority: false },
                }),
            })
        );
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));
    });

    it('rejects a cancelled pending decision', async () => {
        createPendingDecision();
        agentRunLifecycle.cancel({ runId: 'run-decision-resume', reason: 'Cancelled' });
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(false);
        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));
    });

    it.each([
        {
            name: 'a budget exhausted after the decision was persisted',
            input: { budgets: { limits: { localAnalysis: 1 }, consumed: { localAnalysis: 1 } } },
        },
        {
            name: 'a capability schema identity mismatch',
            input: { schemaIdentity: 'retired-catalog-schema' },
        },
    ])('rejects $name before handoff or provider work', async ({ input }) => {
        createPendingDecision(input);

        await expect(
            agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' })
        ).resolves.toEqual(expect.objectContaining({ status: 'rejected' }));

        expect(resumeSend).not.toHaveBeenCalled();
        expect(agentRunLifecycle.get('run-decision-resume')?.decision?.selectedAlternativeId).toBeNull();
    });

    it('admits only one concurrent replacement attempt for a pending decision', async () => {
        createPendingDecision();
        resumeSend.mockImplementation(() => new Promise(() => undefined));

        void agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' });
        void agentRunControls.resumeDecision({ runId: 'run-decision-resume', alternativeId: 'mute' });
        await Promise.resolve();

        expect(resumeSend).toHaveBeenCalledTimes(1);
        expect(agentRunControls.get('run-decision-resume')?.allowedActions.resume).toBe(false);
    });
});
