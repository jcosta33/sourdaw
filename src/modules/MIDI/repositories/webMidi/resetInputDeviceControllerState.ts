import { heldPedalState } from './heldPedalState';
import { resetChannelControllerState } from './resetChannelControllerState';

/**
 * Drop everything the live input's controller told us about itself: the decoded
 * channel state and the pedals it holds down.
 *
 * Called from the device reset / teardown paths only. A transport reset keeps
 * the pedals (`resetChannelControllerState` alone), because a pedal held through
 * a stop or a seek is still held when the next take begins.
 */
export function resetInputDeviceControllerState(): void {
    resetChannelControllerState();
    heldPedalState.clear();
}
