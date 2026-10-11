import { type AppAction, type HandlerExecutionResult } from '#/utils/handlerContract';

import { createExecutionCommandEnvelope } from './createExecutionCommandEnvelope';
import { getCommandHandler } from './getCommandHandler';

type TransactionScope = <Result>(callback: () => Result) => Result;

export type AbortCompensation = {
    readonly actionType: string;
    readonly requiresAbortCompensation: boolean;
    /** The inverse the action's described result holds when it aborts; a handler may assign it while it executes. */
    readonly inverseAction: AppAction | null | undefined;
    readonly commandId: string;
    readonly groupId: string | undefined;
};

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * Replays the inverse of each attempted action that declares its abort is not
 * fully undone by the transaction abort, last attempted first, inside the
 * still-open storage transaction so the inverse sees the state the action left.
 *
 * Unlike a rollback, the first failure stops the replay: an inverse that cannot
 * apply leaves the earlier ones with nothing coherent to restore. Returns that
 * failure, or `null` when every inverse applied.
 */
export async function compensateAbortedActions(
    attemptedActions: readonly AbortCompensation[],
    scope: TransactionScope
): Promise<string | null> {
    const compensableActions = attemptedActions.filter((attempted) => attempted.requiresAbortCompensation);
    if (compensableActions.length === 0) {
        return null;
    }

    try {
        for (const attempted of [...compensableActions].reverse()) {
            const inverseAction = attempted.inverseAction;
            if (!inverseAction) {
                throw new Error(`No inverse action available for ${attempted.actionType}`);
            }
            const inverseHandler = getCommandHandler(inverseAction);
            if (!inverseHandler) {
                throw new Error(`No registered handler for inverse action: ${inverseAction.type}`);
            }
            const compensation = createExecutionCommandEnvelope({
                action: inverseAction,
                dependencyIds: [attempted.commandId],
                expectedEffect: inverseHandler.describe(inverseAction).label,
                options: { groupId: attempted.groupId, source: 'ai' },
            });
            const result: HandlerExecutionResult | void = await scope(() =>
                inverseHandler.execute(compensation.action)
            );
            if (result?.status === 'conflict' || result?.status === 'no-write') {
                throw new Error(`Runtime compensation did not apply for ${inverseAction.type}`);
            }
        }
        return null;
    } catch (error) {
        return failureReason(error);
    }
}
