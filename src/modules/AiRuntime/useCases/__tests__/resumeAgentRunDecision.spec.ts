import { afterEach, describe, expect, it, vi } from 'vitest';

import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

const { resumeSend } = vi.hoisted(() => ({ resumeSend: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../sendChatMessage', () => ({ sendChatMessage: resumeSend }));

import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunControls } from '../getAgentRunControlProjection';

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

function createPendingDecision(): void {
    const revision = captureProjectRevision();
    agentRunLifecycle.create({
        runId: 'run-decision-resume',
        request: 'Mute Bass.',
        mode: 'plan',
        createdRevision: revision,
        scope,
        grants,
    });
    agentRunLifecycle.recordDecision({
        runId: 'run-decision-resume',
        decision: {
            revision,
            scope,
            grants,
            alternatives: [{ id: 'mute', label: 'Mute Bass', changesAuthority: false }],
            reason: 'Choose the bounded interpretation.',
            selectedAlternativeId: null,
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
            selectedAlternativeId: 'mute',
        });
        expect(resumeSend).toHaveBeenCalledWith('Mute Bass.', { mode: 'plan', budgets: { limits: {}, consumed: {} } });
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
});
