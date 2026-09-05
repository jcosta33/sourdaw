import { setMasterGainValue } from '#/modules/AudioEngine/useCases';
import { type HandlerExecutionResult } from '#/utils/handlerContract';

import { transportStore } from '../../stores/transportStore';

/**
 * Realise a committed master-gain write on the engines.
 *
 * Through `setMasterGainValue`, which is the only writer that reaches both
 * carriers: a strip the native engine carries leaves through the native device
 * and never crosses the Web Audio master node. Every action-sourced move of the
 * master arrives here — undo and redo, the command registry, the AI action,
 * Auto-Fix Mix — so a route that moved only the Web Audio fader would leave the
 * native-carried tracks at the level the session opened at, and leave the
 * recorded level the next session start reads pointing at the level before the
 * write.
 */
export function toMasterGainExecutionResult(didWrite: boolean): HandlerExecutionResult {
    if (!didWrite) {
        return { status: 'no-write' };
    }

    const reconcileRuntime = () => {
        const masterGain = transportStore.value?.masterGain;
        if (masterGain !== undefined) {
            setMasterGainValue(masterGain / 100);
        }
    };
    return {
        status: 'written',
        afterCommit: reconcileRuntime,
        afterAmbiguousCommit: reconcileRuntime,
    };
}
