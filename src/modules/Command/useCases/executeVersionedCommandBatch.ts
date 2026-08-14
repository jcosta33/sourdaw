import { type AppAction, type ExecuteOptions } from '#/utils/handlerContract';

import { type VersionedCommandEnvelope, type VersionedCommandReceipt } from '../models/VersionedCommandEnvelope';

import { type CommandBatchValidationPreparation } from './commandBatchValidation';
import { commandProjectDivergencePort } from './commandProjectDivergencePort';
import { commandProjectRevisionPort } from './commandProjectRevisionPort';
import { isExecutableAppActionType } from './executableAppActionRegistry';
import { executeAppActionBatch } from './executeAppActionBatch';
import { getCommandDivergenceTargetIds } from './getCommandDivergenceTargetIds';
import { getCommandHandler } from './getCommandHandler';
import { getExecutableCommandRegistration } from './getExecutableCommandRegistration';
import { hasCurrentCommandDeviceVersions } from './hasCurrentCommandDeviceVersions';
import { parseVersionedCommandEnvelope } from './parseVersionedCommandEnvelope';

type ExecuteVersionedCommandBatchInput = {
    commands: readonly string[];
    divergenceTargetIds?: readonly string[];
    normalizedProjectRevision?: string;
    options?: ExecuteOptions & {
        onProjectCommitPrepared?: (result: {
            status: 'committed';
            actions: readonly { action: AppAction; label: string; receipt?: VersionedCommandReceipt }[];
        }) => void;
        prepareValidation?: (input: { allowCompatibleProjectDivergence: boolean }) => CommandBatchValidationPreparation;
        requireCompensation?: boolean;
    };
};

function describeDivergence(
    kind: NonNullable<ReturnType<typeof commandProjectDivergencePort.classify>>['kind']
): string {
    return `Command batch project divergence is ${kind}`;
}

export async function executeVersionedCommandBatch(input: ExecuteVersionedCommandBatchInput) {
    const envelopes: VersionedCommandEnvelope[] = [];
    for (const serialized of input.commands) {
        const parsed = parseVersionedCommandEnvelope(serialized);
        if (parsed.status === 'invalid') {
            return { status: 'rejected' as const, reason: parsed.reason, actions: [] as [] };
        }
        envelopes.push(parsed.envelope);
    }
    if (envelopes.length === 0) {
        const emptyBatchOptions = input.options ? { ...input.options, prepareValidation: undefined } : undefined;
        return executeAppActionBatch([], emptyBatchOptions);
    }
    const commandIds = envelopes.map((envelope) => envelope.commandId);
    if (new Set(commandIds).size !== commandIds.length) {
        return { status: 'rejected' as const, reason: 'Command IDs must be unique within a batch', actions: [] as [] };
    }
    const batchRevision = input.normalizedProjectRevision ?? envelopes[0]!.normalizedProjectRevision;
    if (envelopes.some((envelope) => envelope.normalizedProjectRevision !== batchRevision)) {
        return {
            status: 'conflicted' as const,
            reason: 'Command batch base revision does not match current project state',
            actions: [] as [],
        };
    }
    for (const [index, envelope] of envelopes.entries()) {
        const earlierCommandIds = new Set(commandIds.slice(0, index));
        if (envelope.dependencyIds.some((dependencyId) => !earlierCommandIds.has(dependencyId))) {
            return {
                status: 'rejected' as const,
                reason: `Command dependencies are missing or out of order for ${envelope.commandId}`,
                actions: [] as [],
            };
        }
    }
    const groupId = envelopes[0]?.groupId;
    if (envelopes.some((envelope) => envelope.groupId !== groupId)) {
        return {
            status: 'rejected' as const,
            reason: 'Command batch contains conflicting group IDs',
            actions: [] as [],
        };
    }
    for (const envelope of envelopes) {
        if (isExecutableAppActionType(envelope.operation)) {
            getExecutableCommandRegistration(envelope.operation);
        }
    }
    // Each envelope was strictly parsed above, preserving the discriminant and
    // argument pairing at this serialized-command boundary.
    const actions = envelopes.map(
        (envelope) => ({ type: envelope.operation, payload: envelope.arguments }) as AppAction
    );
    const targetIds = getCommandDivergenceTargetIds({
        actions,
        targetIds:
            input.divergenceTargetIds ??
            envelopes.flatMap((envelope) => envelope.objectReferences.map((reference) => reference.id)),
    });
    const commandsCompatible = actions.every((action) => {
        const handler = getCommandHandler(action);
        return handler?.canReapplyAfterDivergence?.(action) === true;
    });
    const divergenceState: {
        current: ReturnType<typeof commandProjectDivergencePort.classify>;
    } = { current: null };
    const prepareValidation = input.options?.prepareValidation;
    const result = await executeAppActionBatch(actions, {
        ...input.options,
        commandEnvelopes: envelopes,
        groupId,
        prepareValidation: prepareValidation
            ? () =>
                  prepareValidation({
                      allowCompatibleProjectDivergence: divergenceState.current?.mayReapply === true,
                  })
            : undefined,
        preExecutionValidation: () => {
            const currentRevision = commandProjectRevisionPort.capture();
            if (envelopes.some((envelope) => !hasCurrentCommandDeviceVersions(envelope))) {
                return 'Command batch base revision does not match current project state';
            }
            if (commandProjectRevisionPort.isConfigured() && batchRevision !== currentRevision) {
                if (!commandProjectDivergencePort.isConfigured()) {
                    return 'Command batch base revision does not match current project state';
                }
                divergenceState.current = commandProjectDivergencePort.classify({
                    baseRevision: batchRevision,
                    commandsCompatible,
                    targetIds,
                });
                if (!divergenceState.current?.mayReapply) {
                    if (!divergenceState.current) {
                        return 'Command batch project divergence could not be classified';
                    }
                    return describeDivergence(divergenceState.current.kind);
                }
            } else {
                divergenceState.current = null;
            }
            return null;
        },
    });
    if (result.status === 'conflicted' && divergenceState.current?.mayReapply) {
        const incompatibleDivergence = commandProjectDivergencePort.classify({
            baseRevision: batchRevision,
            commandsCompatible: false,
            targetIds,
        });
        if (incompatibleDivergence && !incompatibleDivergence.mayReapply) {
            return {
                ...result,
                divergence: incompatibleDivergence,
                reason: describeDivergence(incompatibleDivergence.kind),
            };
        }
    }
    if (divergenceState.current && divergenceState.current.kind !== 'none') {
        return { ...result, divergence: divergenceState.current };
    }
    return result;
}
