import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { commandBatchPreviewPort } from './commandBatchPreviewPort';
import { findSingletonBatchAction } from './findSingletonBatchAction';
import { getCommandHandler } from './getCommandHandler';
import { prepareCommandBatchPreflight } from './prepareCommandBatchPreflight';

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
    return typeof value === 'object' && value !== null && 'then' in value;
}

export function previewVersionedCommandBatchEnvelope(envelope: VersionedCommandBatchEnvelope) {
    const preparedValidation = prepareCommandBatchPreflight(envelope);
    if (preparedValidation.status === 'rejected') {
        return { status: 'rejected' as const, reason: preparedValidation.reason, actions: [] as [] };
    }

    const actions = envelope.commands.map(
        (command) => ({ type: command.operation, payload: command.arguments }) as AppAction
    );
    const singletonAction = findSingletonBatchAction(actions);
    if (singletonAction) {
        return {
            status: 'rejected' as const,
            reason: `Action must execute as a singleton batch: ${singletonAction.type}`,
            actions: [] as [],
        };
    }

    const preparedActions = [] as Array<{
        action: AppAction;
        handler: ActionHandler;
        label: string;
    }>;
    for (const action of actions) {
        const handler = getCommandHandler(action);
        if (!handler) {
            return {
                status: 'rejected' as const,
                reason: `No registered handler for action: ${action.type}`,
                actions: [] as [],
            };
        }
        if (
            handler.executionKind === 'runtime' ||
            handler.requiresAbortCompensation !== false ||
            handler.execute.constructor.name === 'AsyncFunction'
        ) {
            return {
                status: 'rejected' as const,
                reason: `Action cannot execute inside an isolated preview: ${action.type}`,
                actions: [] as [],
            };
        }
        let label: string;
        try {
            label = handler.describe(action).label;
        } catch (error) {
            return {
                status: 'rejected' as const,
                reason: `Could not preflight ${action.type}: ${failureReason(error)}`,
                actions: [] as [],
            };
        }
        preparedActions.push({ action, handler, label });
    }

    const workspace = commandBatchPreviewPort.create(envelope.baseRevision);
    if (!workspace) {
        return {
            status: 'rejected' as const,
            reason: 'Command batch preview workspace is unavailable',
            actions: [] as [],
        };
    }

    try {
        const validationActions = preparedActions.map(({ action }) => action);
        for (const [actionIndex, prepared] of preparedActions.entries()) {
            const valid = workspace.scope(
                () =>
                    !prepared.handler.validate ||
                    prepared.handler.validate(prepared.action, { actions: validationActions, actionIndex })
            );
            if (!valid) {
                workspace.release();
                return {
                    status: 'conflicted' as const,
                    reason: `Action conflicts with current project state: ${prepared.action.type}`,
                    actions: [] as [],
                };
            }
        }

        const executedActions: typeof preparedActions = [];
        for (const [actionIndex, prepared] of preparedActions.entries()) {
            const isNoop = workspace.scope(() => prepared.handler.isNoop?.(prepared.action) ?? false);
            if (isNoop) {
                continue;
            }
            const result = workspace.scope(() =>
                prepared.handler.execute(prepared.action, { actions: validationActions, actionIndex })
            );
            if (isPromiseLike(result)) {
                workspace.release();
                return {
                    status: 'rejected' as const,
                    reason: `Action requires asynchronous execution and cannot be isolated: ${prepared.action.type}`,
                    actions: [] as [],
                };
            }
            if (result?.status === 'no-write' || result?.status === 'conflict') {
                workspace.release();
                return {
                    status: 'conflicted' as const,
                    reason: `Action conflicts with current project state: ${prepared.action.type}`,
                    actions: [] as [],
                };
            }
            executedActions.push(prepared);
        }

        if (executedActions.length === 0) {
            workspace.release();
            return { status: 'no-op' as const, actions: [] as [] };
        }

        const projectDocument = workspace.getProjectDocument();
        const postconditionFailure = preparedValidation.postconditions.validate(projectDocument);
        if (postconditionFailure) {
            workspace.release();
            return { status: 'conflicted' as const, reason: postconditionFailure, actions: [] as [] };
        }

        return {
            status: 'previewed' as const,
            actions: executedActions.map(({ action, label }) => ({ action, label })),
            audioGraphValid: true as const,
            baseRevision: envelope.baseRevision,
            projectDocument,
            projectInvariantsValid: true as const,
            resource: {
                baseRevision: envelope.baseRevision,
                release: workspace.release,
            },
        };
    } catch (error) {
        workspace.release();
        return {
            status: 'failed' as const,
            reason: `Command batch preview failed: ${failureReason(error)}`,
            actions: [] as [],
        };
    }
}
