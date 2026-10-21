import { type ProjectContext } from '../../models/ProjectContext';
import { resolveAutomationLaneTarget, SEND_TARGET_PREFIX } from '../../transformers/resolveAutomationLaneTarget';

/**
 * The bus a call's `send:<busId>` parameter names, when the asserted track already sends to it.
 *
 * "Duck the Kick send to the Drum Bus" names the bus as the send the parameter selects, not as a
 * second candidate for the sending track, so resolving the track sets that bus aside. A track that
 * does not send to the bus earns no such exclusion, so the bus cannot stand in for the sender.
 */
export function getAutomatedSendBusIds(parameterId: unknown, trackId: unknown, context: ProjectContext): string[] {
    if (typeof parameterId !== 'string' || !parameterId.startsWith(SEND_TARGET_PREFIX)) {
        return [];
    }
    if (resolveAutomationLaneTarget(context, trackId, parameterId) === null) {
        return [];
    }
    return [parameterId.slice(SEND_TARGET_PREFIX.length)];
}
