import {
    getVersionedCommandTargetRanges,
    migrateLegacyAppActionToVersionedCommandEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { type AgentRunScope } from '../models/AgentRun';

/**
 * The beat spans this action batch compiles to. The scope the application verifies a proposal
 * against and the scope the command batch carries have to name the same ranges, so both read them
 * off the commands through the batch compiler's own derivation instead of restating them. The
 * actions are cloned because compiling an envelope materializes derived arguments into the action
 * it compiles, and this measurement must not reach the batch the application will really execute.
 */
export function getPlannedActionTargetRanges(actions: readonly AppAction[]): AgentRunScope['targetRanges'] {
    return getVersionedCommandTargetRanges(
        actions.map((action) =>
            migrateLegacyAppActionToVersionedCommandEnvelope({
                action: structuredClone(action),
                expectedEffect: action.type,
            })
        )
    );
}
