import { channelControllerState } from './channelControllerState';

/**
 * Drop every channel's decoded controller state (audit MD-7, MD-8).
 *
 * Called from the device reset / teardown paths: latched 14-bit halves and a
 * declared bend range describe the *controller*, so a freshly selected device
 * must start from spec defaults instead of inheriting the previous one's.
 */
export function resetChannelControllerState(): void {
    channelControllerState.clear();
}
