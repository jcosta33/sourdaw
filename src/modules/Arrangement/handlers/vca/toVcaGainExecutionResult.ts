import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { vcaRuntimeProjectionDependencies } from '../../useCases/vca/vcaRuntimeProjectionDependencies';

type ToVcaGainExecutionResultInput = {
    groupIds?: readonly string[];
    trackIds?: readonly string[];
    status: HandlerExecutionResult['status'];
};

export function toVcaGainExecutionResult({
    groupIds = [],
    trackIds = [],
    status,
}: ToVcaGainExecutionResultInput): HandlerExecutionResult {
    if (status !== 'written') {
        return { status };
    }

    const uniqueGroupIds = [...new Set(groupIds)];
    const uniqueTrackIds = [...new Set(trackIds)];
    if (uniqueGroupIds.length === 0 && uniqueTrackIds.length === 0) {
        return { status: 'written' };
    }

    const reconcileRuntime = () => {
        vcaRuntimeProjectionDependencies?.reconcileVcaRuntimeGain({
            groupIds: uniqueGroupIds,
            trackIds: uniqueTrackIds,
        });
    };
    return {
        status: 'written',
        afterCommit: reconcileRuntime,
        afterAmbiguousCommit: reconcileRuntime,
    };
}
