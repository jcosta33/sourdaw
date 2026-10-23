import { channelPitchBendState } from './channelPitchBendState';
import { heldPedalState } from './heldPedalState';
import { resetChannelControllerState } from './resetChannelControllerState';

/**
 * Drop everything the live input's controller told us about itself: the decoded
 * channel state, the pedals it holds down and the pitch wheel's position.
 *
 * Called from the device reset / teardown paths only. A transport reset keeps
 * the pedals and the wheel (`resetChannelControllerState` alone), because a
 * pedal or wheel held through a stop or a seek is still held when the next take
 * begins.
 */
export function resetInputDeviceControllerState(): void {
    resetChannelControllerState();
    heldPedalState.clear();
    channelPitchBendState.clear();
}
