import { channelControllerState } from './channelControllerState';
import { resetMemberExpressionState } from './resetMemberExpressionState';

/**
 * Drop every channel's decoded controller state (audit MD-7, MD-8).
 *
 * Latched 14-bit halves and a declared bend range describe the *controller*, so
 * a freshly selected device must start from spec defaults instead of inheriting
 * the previous one's. The device reset / teardown paths call
 * `resetInputDeviceControllerState`, which also drops the held pedals; this
 * alone is what the transport reset runs and leaves them standing.
 */
export function resetChannelControllerState(): void {
    channelControllerState.clear();
    resetMemberExpressionState();
}
