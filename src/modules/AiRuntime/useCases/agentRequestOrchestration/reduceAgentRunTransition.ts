import { type AgentRunPhase } from '../../models/AgentRun';

const TERMINAL_PHASES = new Set<AgentRunPhase>(['completed', 'failed', 'cancelled', 'partially-completed']);

const REQUESTED_PHASE_TRANSITIONS: Record<AgentRunPhase, ReadonlySet<AgentRunPhase>> = {
    created: new Set(['planning', 'failed', 'cancelled']),
    planning: new Set(['waiting-for-approval', 'previewing', 'executing', 'completed', 'failed', 'cancelled']),
    'waiting-for-approval': new Set(['executing', 'paused', 'failed', 'cancelled']),
    previewing: new Set(['completed', 'paused', 'failed', 'cancelled']),
    executing: new Set(['completed', 'paused', 'failed', 'cancelled', 'partially-completed']),
    paused: new Set(['planning', 'waiting-for-approval', 'previewing', 'executing', 'failed', 'cancelled']),
    completed: new Set(),
    failed: new Set(['paused']),
    cancelled: new Set(),
    'partially-completed': new Set(),
};

export type AgentRunTransitionEvent =
    | { type: 'phase-requested'; phase: AgentRunPhase }
    | { type: 'plan-recorded' }
    | { type: 'manual-resume-required' }
    | { type: 'error-recorded'; terminal: boolean; hasCommittedWork: boolean }
    | { type: 'cancellation-requested'; hasCommittedWork: boolean }
    | { type: 'recovery-resolved'; requiresManualResume: boolean }
    | { type: 'work-retried' }
    | { type: 'work-committed'; completesRun: boolean; hasUnsettledExternalSagaStep: boolean }
    | { type: 'saga-updated'; hasCommittedWork: boolean; hasUnsettledExternalStep: boolean }
    | { type: 'pending-effect-recorded'; hasCommittedWork: boolean }
    | { type: 'pending-effect-completed'; hasRecoveryObligation: boolean };

function requestedPhase(current: AgentRunPhase, next: AgentRunPhase): AgentRunPhase {
    if (current === next) {
        return current;
    }
    if (!REQUESTED_PHASE_TRANSITIONS[current].has(next)) {
        throw new Error(`Agent run cannot transition from ${current} to ${next}`);
    }
    return next;
}

function assertNonTerminal(current: AgentRunPhase, operation: string): void {
    if (TERMINAL_PHASES.has(current)) {
        throw new Error(`Terminal agent run cannot ${operation} from ${current}`);
    }
}

function assertNever(value: never): never {
    throw new Error(`Unknown agent run transition event: ${JSON.stringify(value)}`);
}

export function reduceAgentRunTransition(current: AgentRunPhase, event: AgentRunTransitionEvent): AgentRunPhase {
    switch (event.type) {
        case 'phase-requested':
            return requestedPhase(current, event.phase);
        case 'plan-recorded':
            assertNonTerminal(current, 'record a plan');
            return 'planning';
        case 'manual-resume-required':
            assertNonTerminal(current, 'require resume');
            return 'paused';
        case 'error-recorded':
            if (!event.terminal) {
                return current;
            }
            return event.hasCommittedWork ? 'partially-completed' : 'failed';
        case 'cancellation-requested':
            if (TERMINAL_PHASES.has(current)) {
                return current;
            }
            return event.hasCommittedWork ? 'partially-completed' : 'cancelled';
        case 'recovery-resolved':
            return event.requiresManualResume ? 'paused' : 'partially-completed';
        case 'work-retried':
            if (current === 'completed' || current === 'cancelled') {
                throw new Error(`Agent run cannot retry work from ${current}`);
            }
            return 'executing';
        case 'work-committed':
            if (event.hasUnsettledExternalSagaStep) {
                return 'partially-completed';
            }
            if (event.completesRun) {
                return 'completed';
            }
            return current === 'cancelled' || current === 'failed' ? 'partially-completed' : current;
        case 'saga-updated':
            return event.hasUnsettledExternalStep && event.hasCommittedWork ? 'partially-completed' : current;
        case 'pending-effect-recorded':
            return event.hasCommittedWork ? 'partially-completed' : current;
        case 'pending-effect-completed':
            return event.hasRecoveryObligation ? current : 'completed';
        default:
            return assertNever(event);
    }
}
