import { commandMutationRuntime } from './commandMutationRuntime';

export function isCommandHistoryReplaying(): boolean {
    return commandMutationRuntime.historyReplayDepth > 0;
}
