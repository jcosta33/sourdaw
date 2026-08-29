import { commandBatchExecutionAuthorityPort } from './commandBatchExecutionAuthorityPort';

/** Public authority query for callers that must avoid beginning durable external effects on a joiner. */
export function canExecuteCommandBatchEffects(): boolean {
    return commandBatchExecutionAuthorityPort.canExecute();
}
