import { beforeEach, describe, expect, it } from 'vitest';

import { agentRunLifecycle } from '../agentRunLifecycle';
import { recordPromptBarRunPlan } from '../recordPromptBarRunPlan';

const RUN_ID = 'prompt-bar-plan-authority-run';

const scope = {
    targetIds: ['track-lead', 'clip-lead-1'],
    targetRanges: [
        { startBeat: 4, endBeat: 8 },
        { startBeat: 16, endBeat: 24 },
    ],
    protectedTargetIds: ['track-bass', 'track-drums'],
    protectedRanges: [{ startBeat: 0, endBeat: 4 }],
};
const grants = {
    allowedOperationPrefixes: ['setTrack', 'addDevice'],
    create: true,
    delete: false,
    routing: true,
    tempo: false,
    master: false,
    file: false,
    audioUpload: false,
    remoteGeneration: false,
    autoCommit: true,
};

describe('recordPromptBarRunPlan authority', () => {
    beforeEach(() => {
        agentRunLifecycle.clear();
        agentRunLifecycle.create({
            runId: RUN_ID,
            request: 'Brighten the lead and leave the bass and drums alone.',
            mode: 'apply',
            createdRevision: 'revision-1',
        });
    });

    it('records the compiled authority scope and grants exactly as the run plan', () => {
        const refusal = recordPromptBarRunPlan({
            runId: RUN_ID,
            actionLabels: ['Brighten the lead'],
            metricGoalState: undefined,
            receipts: undefined,
            envelope: { idempotencyKey: 'batch-key-1', commands: [{ commandId: 'command-1' }] },
            authority: { scope, grants },
            revision: 'revision-1',
        });

        expect(refusal).toBeNull();
        const run = agentRunLifecycle.get(RUN_ID);
        expect(run?.plan?.scope).toEqual(scope);
        expect(run?.scope).toEqual(scope);
        expect(run?.grants).toEqual(grants);
    });
});
