import { type AppAction } from '#/utils/handlerContract';

import { type VersionedCommandBatchEnvelope } from '../models/VersionedCommandBatchEnvelope';

import { getBatchCreatedTargetIndex } from './getBatchCreatedTargetIndex';
import { getCommandDivergenceTargetIds } from './getCommandDivergenceTargetIds';
import { isBatchCreatedTargetId } from './isBatchCreatedTargetId';
import { resolveVersionedCommandBatchBindings } from './resolveVersionedCommandBatchBindings';

/**
 * Existing objects the batch's commands touch and the approval preflight must fingerprint for
 * drift. Ids the batch itself creates — assigned no later than every reference to them — are
 * excluded, because they have no pre-batch state to drift from; an id referenced before the
 * command assigning it is that reference's existing target and keeps its fingerprint no matter
 * which command assigns it.
 */
export function getVersionedCommandBatchDivergenceTargetIds(envelope: VersionedCommandBatchEnvelope): string[] {
    const commands = resolveVersionedCommandBatchBindings(envelope);
    const targetIndex = getBatchCreatedTargetIndex(commands);
    const actions = commands.map((command) => ({ type: command.operation, payload: command.arguments }) as AppAction);
    return getCommandDivergenceTargetIds({ actions, targetIds: envelope.scope.targetIds }).filter(
        (targetId) => !isBatchCreatedTargetId(targetIndex, targetId)
    );
}
