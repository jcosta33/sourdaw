import { type HandlerExecutionResult } from '#/utils/handlerContract';

export function toHandlerExecutionResult(didWrite: boolean): HandlerExecutionResult {
    if (!didWrite) {
        return { status: 'no-write' };
    }

    return { status: 'written' };
}
