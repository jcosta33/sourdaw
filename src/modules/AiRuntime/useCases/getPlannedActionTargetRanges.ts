import {
    getVersionedCommandTargetRanges,
    migrateLegacyAppActionToVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunScope } from '../models/AgentRun';

/**
 * The beat spans this action batch compiles to. The scope the application verifies a proposal
 * against and the scope the command batch carries have to name the same ranges, so both read them
 * off the commands through the batch compiler's own derivation instead of restating them.
 *
 * Compiling a command materializes into it, so a measurement that left any of that behind would
 * reach the batch the application really executes: the actions are cloned because a handler
 * materializes derived arguments into the action it is given, and no application default is
 * reserved because those come from pools the session shares, where one drawn here is a colour the
 * next real track never gets.
 */
export function getPlannedActionTargetRanges(actions: readonly AppAction[]): AgentRunScope['targetRanges'] {
    return getVersionedCommandTargetRanges(
        actions.map((action) =>
            migrateLegacyAppActionToVersionedCommandEnvelope({
                action: structuredClone(action),
                expectedEffect: action.type,
                reserveApplicationDefaults: false,
            })
        )
    );
}
