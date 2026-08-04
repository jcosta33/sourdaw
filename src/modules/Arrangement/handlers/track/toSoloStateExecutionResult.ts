import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { applySoloLogic } from '../../useCases/toggleTrackState/applySoloLogic';

export function toSoloStateExecutionResult(didWrite: boolean): HandlerExecutionResult {
    if (!didWrite) {
        return { status: 'no-write' };
    }

    const reconcileRuntime = () => {
        applySoloLogic();
    };
    return {
        status: 'written',
        afterCommit: reconcileRuntime,
        afterAmbiguousCommit: reconcileRuntime,
    };
}
