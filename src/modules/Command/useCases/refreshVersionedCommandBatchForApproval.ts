import { type AppAction } from '#/utils/handlerContract';

import { type CommandBatchAuthority } from '../models/VersionedCommandBatchEnvelope';

import { commandProjectDivergencePort } from './commandProjectDivergencePort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { compileVersionedCommandBatchEnvelope } from './compileVersionedCommandBatchEnvelope';
import { getCommandHandler } from './getCommandHandler';
import { getVersionedCommandBatchDivergenceTargetIds } from './getVersionedCommandBatchDivergenceTargetIds';
import { hasCurrentCommandDeviceVersions } from './hasCurrentCommandDeviceVersions';
import { parseVersionedCommandBatchEnvelope } from './parseVersionedCommandBatchEnvelope';
import { prepareCommandBatchPreflight } from './prepareCommandBatchPreflight';
import { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandEnvelope } from './serializeVersionedCommandEnvelope';

type RefreshVersionedCommandBatchForApprovalInput = {
    authority: CommandBatchAuthority;
    serialized: string;
};

/** The owner's own reason, when it gives one, so the musician reads why rather than the operation name. */
function describeValidationConflict(actionType: string, refusal: string | null): string {
    const conflict = `Action conflicts with current project state: ${actionType}`;
    if (refusal === null) {
        return conflict;
    }
    return `${conflict}: ${refusal}`;
}

function failureReason(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export function refreshVersionedCommandBatchForApproval(input: RefreshVersionedCommandBatchForApprovalInput) {
    const parsed = parseVersionedCommandBatchEnvelope(input.serialized, input.authority);
    if (parsed.status === 'invalid') {
        return { status: 'rejected' as const, reason: parsed.reason };
    }
    if (!commandProjectRevisionPort.isConfigured() || !commandProjectDivergencePort.isConfigured()) {
        return {
            status: 'rejected' as const,
            reason: 'Command batch project divergence classification is unavailable',
        };
    }
    const envelope = parsed.envelope;
    const resolvedCommands = resolveVersionedCommandBatchBindings(envelope);
    const resolvedEnvelope = { ...envelope, commands: resolvedCommands };
    const actions = resolvedCommands.map(
        (command) => ({ type: command.operation, payload: command.arguments }) as AppAction
    );
    const commandsCompatible = actions.every((action, actionIndex) => {
        const handler = getCommandHandler(action);
        return handler?.canReapplyAfterDivergence?.(action, { actions, actionIndex }) === true;
    });
    const targetIds = getVersionedCommandBatchDivergenceTargetIds(resolvedEnvelope);
    const divergence = commandProjectDivergencePort.classify({
        baseRevision: envelope.baseRevision,
        commandsCompatible,
        targetIds,
    });
    if (!divergence) {
        return { status: 'rejected' as const, reason: 'Command batch project divergence could not be classified' };
    }
    if (!divergence.mayReapply) {
        return {
            status: 'conflicted' as const,
            divergence,
            reason: `Command batch project divergence is ${divergence.kind}`,
            refusal: null,
        };
    }
    try {
        if (resolvedCommands.some((command) => !hasCurrentCommandDeviceVersions(command))) {
            return {
                status: 'conflicted' as const,
                divergence,
                reason: 'Command device versions changed after approval',
                refusal: null,
            };
        }
        for (const [actionIndex, action] of actions.entries()) {
            const handler = getCommandHandler(action);
            const validationContext = { actions, actionIndex };
            if (!handler?.validate || !handler.validate(action, validationContext)) {
                const incompatible = commandProjectDivergencePort.classify({
                    baseRevision: envelope.baseRevision,
                    commandsCompatible: false,
                    targetIds,
                });
                const refusal = handler?.validationRefusalReason?.(action, validationContext) ?? null;
                return {
                    status: 'conflicted' as const,
                    divergence: incompatible ?? divergence,
                    reason: describeValidationConflict(action.type, refusal),
                    refusal,
                };
            }
        }
    } catch (error) {
        return { status: 'rejected' as const, reason: `Command revalidation failed: ${failureReason(error)}` };
    }

    const currentRevision = commandProjectRevisionPort.capture();
    const commandEnvelopes = envelope.commands.map((command) =>
        serializeVersionedCommandEnvelope({ ...command, normalizedProjectRevision: currentRevision })
    );
    try {
        const commandBatch = compileVersionedCommandBatchEnvelope({
            autoCommit: envelope.grants.autoCommit,
            baseRevision: currentRevision,
            batchId: envelope.batchId,
            batchLocalBindings: envelope.batchLocalBindings,
            commands: commandEnvelopes,
            dynamicEffects: envelope.dynamicEffects,
            intent: envelope.intent,
            mode: envelope.mode,
            projectId: envelope.projectId,
            protectedRanges: envelope.scope.protectedRanges,
            protectedTargetIds: envelope.scope.protectedTargetIds,
            runId: envelope.runId,
        });
        const refreshed = parseVersionedCommandBatchEnvelope(commandBatch.serialized, commandBatch.authority);
        if (refreshed.status === 'invalid') {
            return { status: 'rejected' as const, reason: refreshed.reason };
        }
        const preflight = prepareCommandBatchPreflight(refreshed.envelope);
        if (preflight.status === 'rejected') {
            return { status: 'rejected' as const, reason: preflight.reason };
        }
        return {
            status: 'ready' as const,
            commandBatch,
            commandEnvelopes,
            currentRevision,
            divergence,
        };
    } catch (error) {
        return { status: 'rejected' as const, reason: failureReason(error) };
    }
}
