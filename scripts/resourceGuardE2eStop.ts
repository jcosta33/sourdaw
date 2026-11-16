import type { GuardedCommandResult } from './resourceGuard.ts';

const SIGINT_EXIT_CODE = 130;
const SIGTERM_EXIT_CODE = 143;

function endedByStopRequest(result: Pick<GuardedCommandResult, 'code' | 'signal'>): boolean {
    if (result.signal === 'SIGINT' || result.signal === 'SIGTERM') {
        return true;
    }
    return result.signal === null && (result.code === SIGINT_EXIT_CODE || result.code === SIGTERM_EXIT_CODE);
}

/**
 * A recorded e2e dev server never exits by itself, so its recovery proof ends
 * only when someone stops it: SIGINT is re-raised by the runner and SIGTERM
 * exits 143. Once the guard's observer verified the server under this run's
 * token, that stop is the proof's success. A guard-issued stop (timeout,
 * memory, leak) carries a `reason` and never qualifies.
 */
export function isVerifiedE2eServerStop(
    result: Pick<GuardedCommandResult, 'code' | 'signal' | 'reason'>,
    observation: { observed: boolean; mismatch?: string }
): boolean {
    return (
        result.reason === undefined &&
        observation.observed &&
        observation.mismatch === undefined &&
        endedByStopRequest(result)
    );
}
