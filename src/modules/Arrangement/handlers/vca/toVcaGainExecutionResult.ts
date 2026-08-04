import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { vcaRuntimeProjectionDependencies } from '../../useCases/vca/vcaRuntimeProjectionDependencies';

type ToVcaGainExecutionResultInput = {
    groupIds: readonly string[];
    status: HandlerExecutionResult['status'];
};

export function toVcaGainExecutionResult({ groupIds, status }: ToVcaGainExecutionResultInput): HandlerExecutionResult {
    if (status !== 'written') {
        return { status };
    }
    const reconcileRuntime = () => {
        for (const groupId of new Set(groupIds)) {
            vcaRuntimeProjectionDependencies?.reconcileVcaGroupRuntimeGain(groupId);
        }
    };
    return {
        status: 'written',
        afterCommit: reconcileRuntime,
        afterAmbiguousCommit: reconcileRuntime,
    };
}
