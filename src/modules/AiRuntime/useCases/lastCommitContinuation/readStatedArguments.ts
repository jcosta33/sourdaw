import { getExecutableAppActionProviderSchema, isExecutableAppActionType } from '#/modules/Command/useCases';

import { type CommittedCommand } from './lastCommitOutcome';

/** The arguments a provider may state for the command, as committed: never a guard the application added. */
export function readStatedArguments(command: CommittedCommand): Record<string, unknown> {
    if (!isExecutableAppActionType(command.type)) {
        return {};
    }
    const declared = getExecutableAppActionProviderSchema(command.type).properties;
    return Object.fromEntries(
        Object.entries(command.payload).filter(([argument]) => Object.hasOwn(declared, argument))
    );
}
