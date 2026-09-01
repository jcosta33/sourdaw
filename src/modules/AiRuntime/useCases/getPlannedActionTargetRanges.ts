import {
    getVersionedCommandTargetRanges,
    migrateLegacyAppActionToVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunScope } from '../models/AgentRun';

/**
 * Compiling a command materializes into it, so a measurement that left any of that behind would
 * reach the batch the application really executes: the action is cloned because a handler
 * materializes derived arguments into the action it is given, and no application default is
 * reserved because those come from pools the session shares, where one drawn here is a colour the
 * next real track never gets.
 *
 * Materialization reads live project state and throws on a reference that does not resolve, which
 * is a verdict on the action rather than on the measurement. Measuring is evidence-gathering, so an
 * action that cannot compile here simply contributes no evidence: rejecting an unresolvable
 * reference belongs to the confirm-time compile that executes the batch, which states its own
 * reason, and a throw escaping here would instead discard the whole plan before anything judged it.
 */
function measureCompilableAction(action: AppAction) {
    try {
        return [
            migrateLegacyAppActionToVersionedCommandEnvelope({
                action: structuredClone(action),
                expectedEffect: action.type,
                reserveApplicationDefaults: false,
            }),
        ];
    } catch {
        return [];
    }
}

/**
 * The beat spans this action batch compiles to. The scope the application verifies a proposal
 * against and the scope the command batch carries have to name the same ranges, so both read them
 * off the commands through the batch compiler's own derivation instead of restating them.
 */
export function getPlannedActionTargetRanges(actions: readonly AppAction[]): AgentRunScope['targetRanges'] {
    return getVersionedCommandTargetRanges(actions.flatMap(measureCompilableAction));
}
