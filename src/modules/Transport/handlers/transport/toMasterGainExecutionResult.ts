import { setMasterGain } from '#/modules/AudioEngine/useCases';
import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { transportStore } from '../../stores/transportStore';

export function toMasterGainExecutionResult(didWrite: boolean): HandlerExecutionResult {
    if (!didWrite) {
        return { status: 'no-write' };
    }

    const reconcileRuntime = () => {
        const masterGain = transportStore.value?.masterGain;
        if (masterGain !== undefined) {
            setMasterGain(masterGain / 100);
        }
    };
    return {
        status: 'written',
        afterCommit: reconcileRuntime,
        afterAmbiguousCommit: reconcileRuntime,
    };
}
