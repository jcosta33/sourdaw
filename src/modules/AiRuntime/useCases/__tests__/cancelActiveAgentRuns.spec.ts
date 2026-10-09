import { beforeEach, describe, expect, it } from 'vitest';

import { readAgentRunState } from '../../stores/agentRunStore';
import { agentRunLifecycle } from '../agentRunLifecycle';
import { agentRunWorkLease } from '../agentRunWorkLease';
import { cancelActiveAgentRuns } from '../cancelActiveAgentRuns';
import { agentRunCancellation } from '../cancelAgentRun';

const { clear: clearAgentRuns, create: createAgentRun, get: getAgentRun } = agentRunLifecycle;

function createExecutingRunWithBoundRender(runId: string): AbortController {
    createAgentRun({
        runId,
        request: 'Render the chorus.',
        mode: 'macro',
        createdRevision: 'heads-a',
        createdAt: 100,
    });
    // `created` has no edge to `executing`: production records a plan first,
    // so the run starts from the phase it actually holds when it claims render
    // work, exactly as `agentRunWorkLease.spec.ts` sets one up.
    agentRunLifecycle.transitionPhase({ runId, phase: 'planning', transitionedAt: 101 });
    const claimed = agentRunWorkLease.claim({
        runId,
        workId: `${runId}-render`,
        ownerKind: 'render',
        cleanupOwner: 'render-worker',
        idempotencyKey: `${runId}-render-key`,
        receiptIdentity: `${runId}-render-receipt`,
        idempotent: true,
        retriable: true,
        claimedAt: 110,
    });
    if (claimed.status !== 'claimed') {
        throw new Error(`Expected the render work lease to be claimed: ${runId}`);
    }
    agentRunLifecycle.transitionPhase({ runId, phase: 'executing', transitionedAt: 112 });
    const controller = new AbortController();
    agentRunCancellation.bindAbortController({
        runId,
        lease: claimed.lease,
        controller,
        reason: 'User cancelled the run while confirmed command execution was active.',
    });
    return controller;
}

describe('cancelActiveAgentRuns', () => {
    beforeEach(() => {
        clearAgentRuns();
    });

    it('cancels an executing run and aborts the abort controller its render bound', () => {
        // The bound controller is what the in-flight section render observes
        // (`renderAgentProjectSections` passes it to `renderOffline` as the
        // render's `abortSignal`), so its abort is the lock-release path: the
        // process-wide render lock frees when the aborted render unwinds.
        const renderController = createExecutingRunWithBoundRender('run-boundary');

        cancelActiveAgentRuns();

        expect(renderController.signal.aborted).toBe(true);
        expect(getAgentRun('run-boundary')?.phase).toBe('cancelled');
        expect(readAgentRunState().runs).toHaveLength(1);
    });

    it('leaves a run holding no machine resources to the run lifecycle', () => {
        // A `created` run claims no work and holds no render lock, so the
        // boundary does not cancel it — only the active phases do.
        createAgentRun({
            runId: 'run-idle',
            request: 'Still only created.',
            mode: 'macro',
            createdRevision: 'heads-a',
            createdAt: 100,
        });

        cancelActiveAgentRuns();

        const idle = getAgentRun('run-idle');
        expect(idle?.phase).toBe('created');
        expect(idle?.cancellation.requestedAt).toBeNull();
    });
});
