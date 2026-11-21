import { findPadOutputHost } from './findPadOutputHost';

/** True when the chain holds a pad-output host. */
export function hasPadOutputHost(devices: readonly Readonly<{ type: string }>[]): boolean {
    return findPadOutputHost(devices) !== undefined;
}
