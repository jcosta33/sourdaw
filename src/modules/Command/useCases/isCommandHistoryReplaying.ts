import { commandMutationRuntime } from './commandMutationRuntime';

export function isCommandHistoryReplaying(): boolean {
    return commandMutationRuntime.synchronousOwner?.replay === true;
}
