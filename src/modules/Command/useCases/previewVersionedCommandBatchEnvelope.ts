import { type ActionHandler, type AppAction } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { buildSemanticProjectDiff } from './buildSemanticProjectDiff';
import { commandBatchPreviewPort } from './commandBatchPreviewPort';
import { findSingletonBatchAction } from './findSingletonBatchAction';
import { getCommandHandler } from './getCommandHandler';
import { partialCommandBatchSelection } from './partialCommandBatchSelection';
import { prepareCommandBatchPreflight } from './prepareCommandBatchPreflight';

type PreviewActionHandler = Extract<ActionHandler, { previewExecution: 'isolated-project' }>;

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
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
        command: VersionedCommandBatchEnvelope['commands'][number];
        handler: PreviewActionHandler;
        label: string;
        recovery: 'inverse' | 'compensable' | 'irreversible';
    }>;
    for (const [actionIndex, action] of actions.entries()) {
        const handler = getCommandHandler(action);
        if (!handler) {
            return {
                status: 'rejected' as const,
                reason: `No registered handler for action: ${action.type}`,
                actions: [] as [],
            };
        }
        if (handler.executionKind === 'runtime' || handler.previewExecution !== 'isolated-project') {
            return {
                status: 'rejected' as const,
                reason: `Action cannot execute inside an isolated preview: ${action.type}`,
                actions: [] as [],
            };
        }
        let description: ReturnType<PreviewActionHandler['describe']>;
        try {
            description = handler.describe(action);
        } catch (error) {
            return {
                status: 'rejected' as const,
                reason: `Could not preflight ${action.type}: ${failureReason(error)}`,
                actions: [] as [],
            };
        }
        let recovery: 'inverse' | 'compensable' | 'irreversible' = 'irreversible';
        if (description.inverseAction && handler.undoable) {
            recovery = 'inverse';
        } else if (description.inverseAction || handler.prepareAbort) {
            recovery = 'compensable';
        }
        preparedActions.push({
            action,
            command: envelope.commands[actionIndex]!,
            handler,
            label: description.label,
            recovery,
        });
    }

    let workspace;
    try {
        workspace = commandBatchPreviewPort.create(envelope.baseRevision);
    } catch (error) {
        return {
            status: 'rejected' as const,
            reason: `Command batch preview workspace is unavailable: ${failureReason(error)}`,
            actions: [] as [],
        };
    }
    if (!workspace) {
        return {
            status: 'rejected' as const,
            reason: 'Command batch preview workspace is unavailable',
            actions: [] as [],
        };
    }
    const previewWorkspace = workspace;

    try {
        const validationActions = preparedActions.map(({ action }) => action);
        for (const [actionIndex, prepared] of preparedActions.entries()) {
            const valid = workspace.scope(
                () =>
                    !prepared.handler.validate ||
                    prepared.handler.validate(prepared.action, {
                        actions: validationActions,
                        actionIndex,
                        executionMode: 'isolated-preview',
                    })
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
                prepared.handler.execute(prepared.action, {
                    actions: validationActions,
                    actionIndex,
                    executionMode: 'isolated-preview',
                })
            );
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

        const partialAcceptance = partialCommandBatchSelection.create(
            envelope,
            executedActions.map(({ command }) => command.commandId)
        );
        let released = false;
        function release() {
            partialCommandBatchSelection.revoke(partialAcceptance);
            if (!released) {
                released = true;
                previewWorkspace.release();
            }
        }

        return {
            status: 'previewed' as const,
            actions: executedActions.map(({ action, label }) => ({ action, label })),
            audioGraphValid: true as const,
            baseRevision: envelope.baseRevision,
            projectDocument,
            projectInvariantsValid: true as const,
            partialAcceptance,
            semanticDiff: buildSemanticProjectDiff({
                envelope: { ...envelope, commands: executedActions.map(({ command }) => command) },
                projectDocument,
                recoveryByCommandId: Object.fromEntries(
                    executedActions.map(({ command, recovery }) => [command.commandId, recovery])
                ),
            }),
            resource: {
                baseRevision: envelope.baseRevision,
                release,
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
