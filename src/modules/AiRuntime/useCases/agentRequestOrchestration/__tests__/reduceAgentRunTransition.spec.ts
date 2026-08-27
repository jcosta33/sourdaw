import { describe, expect, it } from 'vitest';

import { AGENT_RUN_PHASES, type AgentRunPhase } from '../../../models/AgentRun';
import { type AgentRunTransitionEvent, reduceAgentRunTransition } from '../reduceAgentRunTransition';

const REQUESTED_PHASE_MATRIX: Record<AgentRunPhase, readonly AgentRunPhase[]> = {
    created: ['created', 'planning', 'failed', 'cancelled'],
    planning: ['planning', 'waiting-for-approval', 'previewing', 'executing', 'completed', 'failed', 'cancelled'],
    'waiting-for-approval': ['waiting-for-approval', 'executing', 'paused', 'failed', 'cancelled'],
    previewing: ['previewing', 'completed', 'paused', 'failed', 'cancelled'],
    executing: ['executing', 'completed', 'paused', 'failed', 'cancelled', 'partially-completed'],
    paused: ['paused', 'planning', 'waiting-for-approval', 'previewing', 'executing', 'failed', 'cancelled'],
    completed: ['completed'],
    failed: ['failed', 'paused'],
    cancelled: ['cancelled'],
    'partially-completed': ['partially-completed'],
};

const NON_TERMINAL_PHASES = new Set<AgentRunPhase>([
    'created',
    'planning',
    'waiting-for-approval',
    'previewing',
    'executing',
    'paused',
]);

function expectTransition(current: AgentRunPhase, event: AgentRunTransitionEvent, expected: AgentRunPhase): void {
    expect(reduceAgentRunTransition(current, event)).toBe(expected);
}

describe('reduceAgentRunTransition', () => {
    it('covers every requested phase pair and fails closed outside the transition matrix', () => {
        for (const current of AGENT_RUN_PHASES) {
            for (const requested of AGENT_RUN_PHASES) {
                if (REQUESTED_PHASE_MATRIX[current].includes(requested)) {
                    expectTransition(current, { type: 'phase-requested', phase: requested }, requested);
                    continue;
                }

                expect(() => reduceAgentRunTransition(current, { type: 'phase-requested', phase: requested })).toThrow(
                    `Agent run cannot transition from ${current} to ${requested}`
                );
            }
        }
    });

    it('covers lifecycle-owned planning, pause, error, and cancellation mappings for every phase', () => {
        for (const current of AGENT_RUN_PHASES) {
            if (NON_TERMINAL_PHASES.has(current)) {
                expectTransition(current, { type: 'plan-recorded' }, 'planning');
                expectTransition(current, { type: 'manual-resume-required' }, 'paused');
                expectTransition(current, { type: 'cancellation-requested', hasCommittedWork: false }, 'cancelled');
                expectTransition(
                    current,
                    { type: 'cancellation-requested', hasCommittedWork: true },
                    'partially-completed'
                );
            } else {
                expect(() => reduceAgentRunTransition(current, { type: 'plan-recorded' })).toThrow(
                    `Terminal agent run cannot record a plan from ${current}`
                );
                expect(() => reduceAgentRunTransition(current, { type: 'manual-resume-required' })).toThrow(
                    `Terminal agent run cannot require resume from ${current}`
                );
                expectTransition(current, { type: 'cancellation-requested', hasCommittedWork: false }, current);
                expectTransition(current, { type: 'cancellation-requested', hasCommittedWork: true }, current);
            }

            expectTransition(current, { type: 'error-recorded', terminal: false, hasCommittedWork: false }, current);
            expectTransition(current, { type: 'error-recorded', terminal: false, hasCommittedWork: true }, current);
            expectTransition(current, { type: 'error-recorded', terminal: true, hasCommittedWork: false }, 'failed');
            expectTransition(
                current,
                { type: 'error-recorded', terminal: true, hasCommittedWork: true },
                'partially-completed'
            );
        }
    });

    it('covers recovery, retry, saga, and pending-effect mappings for every phase', () => {
        for (const current of AGENT_RUN_PHASES) {
            expectTransition(current, { type: 'recovery-resolved', requiresManualResume: true }, 'paused');
            expectTransition(
                current,
                { type: 'recovery-resolved', requiresManualResume: false },
                'partially-completed'
            );

            if (current === 'completed' || current === 'cancelled') {
                expect(() => reduceAgentRunTransition(current, { type: 'work-retried' })).toThrow(
                    `Agent run cannot retry work from ${current}`
                );
            } else {
                expectTransition(current, { type: 'work-retried' }, 'executing');
            }

            expectTransition(
                current,
                { type: 'saga-updated', hasCommittedWork: true, hasUnsettledExternalStep: true },
                'partially-completed'
            );
            expectTransition(
                current,
                { type: 'saga-updated', hasCommittedWork: false, hasUnsettledExternalStep: true },
                current
            );
            expectTransition(
                current,
                { type: 'saga-updated', hasCommittedWork: true, hasUnsettledExternalStep: false },
                current
            );
            expectTransition(
                current,
                { type: 'saga-updated', hasCommittedWork: false, hasUnsettledExternalStep: false },
                current
            );
            expectTransition(
                current,
                { type: 'pending-effect-recorded', hasCommittedWork: true },
                'partially-completed'
            );
            expectTransition(current, { type: 'pending-effect-recorded', hasCommittedWork: false }, current);
            expectTransition(current, { type: 'pending-effect-completed', hasRecoveryObligation: true }, current);
            expectTransition(current, { type: 'pending-effect-completed', hasRecoveryObligation: false }, 'completed');
        }
    });

    it('preserves committed-work completion, partial, late-receipt, and unchanged phase mappings', () => {
        for (const current of AGENT_RUN_PHASES) {
            expectTransition(
                current,
                { type: 'work-committed', completesRun: true, hasUnsettledExternalSagaStep: false },
                'completed'
            );
            expectTransition(
                current,
                { type: 'work-committed', completesRun: true, hasUnsettledExternalSagaStep: true },
                'partially-completed'
            );
            expectTransition(
                current,
                { type: 'work-committed', completesRun: false, hasUnsettledExternalSagaStep: true },
                'partially-completed'
            );
            expectTransition(
                current,
                { type: 'work-committed', completesRun: false, hasUnsettledExternalSagaStep: false },
                current === 'cancelled' || current === 'failed' ? 'partially-completed' : current
            );
        }
    });
});
