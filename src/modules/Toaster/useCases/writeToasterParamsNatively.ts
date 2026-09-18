import { writeNativeBuiltinParameters } from '#/modules/AudioEngine/useCases';

import { type ToasterEngineMessage } from './projectToasterKitToEngineMessages';
import { toasterNativeParamName } from './toasterNativeParamName';

export type WriteToasterParamsNativelyInput = {
    trackId: string;
    deviceId: string;
    /** The control writes the worklet was just given, in engine spelling. */
    messages: readonly ToasterEngineMessage[];
};

/**
 * Send the control writes a live Toaster edit just posted to its worklet on to
 * the native session as well (#3124).
 *
 * Toaster's audible identity is pushed as control writes rather than stored as
 * `parameterValues`, so a panel drag never reaches `updateDeviceParam` — the
 * one door that also writes natively. Without this, a natively carried Toaster
 * held whatever kit the topology splice sent and nothing a musician moved was
 * audible until the next rebuild re-projected `deviceState`.
 *
 * Additive on top of the worklet write, never instead of it: the web node
 * stays the strip's fallback carrier and has to hold the current value for the
 * moment the session's gate reopens at Stop. `writeNativeBuiltinParameters`
 * answers nothing and sends nothing when the session is not carrying this
 * device, so a call from a web-only session costs a store read.
 */
export function writeToasterParamsNatively({ trackId, deviceId, messages }: WriteToasterParamsNativelyInput): void {
    if (messages.length === 0) {
        return;
    }
    const values: Record<string, number> = {};
    for (const message of messages) {
        values[toasterNativeParamName(message)] = message.value;
    }
    writeNativeBuiltinParameters(trackId, deviceId, values);
}
