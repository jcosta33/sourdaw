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
    const replayOwner = createCommandMutationOwner(owner);
    function runLegacyMutation<MutationOutput>(
        mutation: LegacyCommandMutation<MutationOutput>
    ): Promise<MutationOutput> {
        return runLegacyCommandMutationUnderOwner(replayOwner, mutation);
    }
    const previousSynchronousOwner = commandMutationRuntime.synchronousOwner;
    commandMutationRuntime.synchronousOwner = replayOwner;
    let result: Promise<unknown>;
    try {
        result = Promise.resolve(operation(runLegacyMutation));
    } catch (error) {
        result = Promise.reject(toCommandMutationError(error));
    } finally {
        commandMutationRuntime.synchronousOwner = previousSynchronousOwner;
    }

    let output: unknown;
    let replayFailure: unknown;
    let replayFailed = false;
    try {
        output = await result;
    } catch (error) {
        replayFailed = true;
        replayFailure = error;
    }

    try {
        await waitForCommandMutationOwner(replayOwner);
    } catch (error) {
        if (!replayFailed) {
            replayFailed = true;
            replayFailure = error;
        }
    } finally {
        replayOwner.active = false;
    }

    if (replayFailed) {
        throw toCommandMutationError(replayFailure);
    }
    return output as Output;
}
