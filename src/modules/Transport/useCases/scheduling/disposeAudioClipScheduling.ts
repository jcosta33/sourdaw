import { gainNodePool } from './audioClipSchedulingState';

/**
 * Reset this module's process-lifetime holders so a stale `gainNodePool`
 * (which grows monotonically and is bound to a now-discarded AudioContext)
 * does not survive an HMR reload or a project switch. Disconnecting pooled
 * nodes drops their reference into the old graph so it can be collected.
 */
export function disposeAudioClipScheduling(): void {
    for (const node of gainNodePool) {
        try {
            node.disconnect();
        } catch {
            // node might already be disconnected
        }
    }
    gainNodePool.length = 0;
}
