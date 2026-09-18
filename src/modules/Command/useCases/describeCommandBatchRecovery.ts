import { type AppAction, type HandlerDescribeResult } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { type CommandRecovery, classifyCommandRecovery } from './classifyCommandRecovery';
import { getCommandHandler } from './getCommandHandler';

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/**
 * An executable action type whose registration is incomplete throws out of resolution rather
 * than resolving to nothing, and this runs on the proposal path, where losing the recovery
 * projection must not also lose the proposal.
 */
function resolveCommandHandler(action: AppAction) {
    try {
        const handler = getCommandHandler(action);
        if (!handler) {
            return { status: 'rejected' as const, reason: `No registered handler for action: ${action.type}` };
        }
        return { status: 'resolved' as const, handler };
    } catch (error) {
        return { status: 'rejected' as const, reason: failureReason(error) };
    }
}

/**
 * Per-command recovery for a batch nobody has previewed, so an approval view can name
 * destructive consequences without opening an isolated workspace.
 */
export function describeCommandBatchRecovery(envelope: VersionedCommandBatchEnvelope) {
    const actions = envelope.commands.map(
        (command) => ({ type: command.operation, payload: command.arguments }) as AppAction
    );
    const recoveryByCommandId: Record<string, CommandRecovery> = {};
    for (const [actionIndex, action] of actions.entries()) {
        const resolved = resolveCommandHandler(action);
        if (resolved.status === 'rejected') {
            return { status: 'rejected' as const, reason: resolved.reason };
        }
        let description: HandlerDescribeResult;
        try {
            description = resolved.handler.describe(action, {
                actions,
                actionIndex,
                executionMode: 'isolated-preview',
            });
        } catch (error) {
            return {
                status: 'rejected' as const,
                reason: `Could not preflight ${action.type}: ${failureReason(error)}`,
            };
        }
        recoveryByCommandId[envelope.commands[actionIndex]!.commandId] = classifyCommandRecovery(
            resolved.handler,
            description
        );
    }
    return { status: 'described' as const, recoveryByCommandId };
}
