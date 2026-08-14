import { type AppAction } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { getCommandDivergenceTargetIds } from './getCommandDivergenceTargetIds';
import { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';

export function getVersionedCommandBatchDivergenceTargetIds(envelope: VersionedCommandBatchEnvelope): string[] {
    const commands = resolveVersionedCommandBatchBindings(envelope);
    const assignedIds = new Set(
        commands.flatMap((command) => command.applicationAssignedIds.map((assigned) => assigned.value))
    );
    const actions = commands.map((command) => ({ type: command.operation, payload: command.arguments }) as AppAction);
    return getCommandDivergenceTargetIds({ actions, targetIds: envelope.scope.targetIds }).filter(
        (targetId) => !assignedIds.has(targetId)
    );
}
