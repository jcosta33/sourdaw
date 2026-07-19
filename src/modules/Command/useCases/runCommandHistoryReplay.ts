import { commandMutationRuntime } from './commandMutationRuntime';

export function runCommandHistoryReplay<Output>(operation: () => Output): Output {
    commandMutationRuntime.historyReplayDepth += 1;
    try {
        return operation();
    } finally {
        commandMutationRuntime.historyReplayDepth -= 1;
    }
}
