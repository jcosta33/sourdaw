import { type CommandHistoryReplay } from '#/utils/handlerContract';

import { createCommandMutationOwner, type CommandMutationOwner } from './commandMutationOwner';
import { commandMutationRuntime } from './commandMutationRuntime';
import { type LegacyCommandMutation } from './legacyCommandMutationContract';
import { runLegacyCommandMutationUnderOwner } from './runLegacyCommandMutationUnderOwner';
import { toCommandMutationError } from './toCommandMutationError';
import { waitForCommandMutationOwner } from './waitForCommandMutationOwner';

export async function runCommandHistoryReplay<Output>(
    owner: CommandMutationOwner,
    operation: CommandHistoryReplay
): Promise<Output> {
    const replay_owner = createCommandMutationOwner(owner);
    function run_legacy_mutation<MutationOutput>(
        mutation: LegacyCommandMutation<MutationOutput>
    ): Promise<MutationOutput> {
        return runLegacyCommandMutationUnderOwner(replay_owner, mutation);
    }
    const previous_synchronous_owner = commandMutationRuntime.synchronousOwner;
    commandMutationRuntime.synchronousOwner = replay_owner;
    let result: Promise<unknown>;
    try {
        result = Promise.resolve(operation(run_legacy_mutation));
    } catch (error) {
        result = Promise.reject(toCommandMutationError(error));
    } finally {
        commandMutationRuntime.synchronousOwner = previous_synchronous_owner;
    }

    let output: unknown;
    let replay_failure: unknown;
    let replay_failed = false;
    try {
        output = await result;
    } catch (error) {
        replay_failed = true;
        replay_failure = error;
    }

    try {
        await waitForCommandMutationOwner(replay_owner);
    } catch (error) {
        if (!replay_failed) {
            replay_failed = true;
            replay_failure = error;
        }
    } finally {
        replay_owner.active = false;
    }

    if (replay_failed) {
        throw toCommandMutationError(replay_failure);
    }
    return output as Output;
}
