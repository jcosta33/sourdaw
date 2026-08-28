import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type ScanResult } from './types';

/**
 * What `scanPlugins` can answer: a scan that ran and reported, or the reason
 * no scan could run at all.
 *
 * The distinction is load-bearing for the store: only a scan that actually
 * enumerated may restate the plugin list, so "could not run" has to survive as
 * its own shape instead of masquerading as an empty `ScanResult` — an empty
 * `plugins` array from a scan that never happened is indistinguishable from a
 * genuinely empty scan, and the first would wipe the list the second
 * legitimately clears.
 */
export type PluginScanAttempt = { ran: true; result: ScanResult } | { ran: false; reason: string };

export async function scanPlugins(paths: string[]): Promise<PluginScanAttempt> {
    if (!isDesktopRuntime()) {
        return { ran: false, reason: 'Plugin scanning requires the desktop app' };
    }
    return { ran: true, result: (await desktopInvoke('scan_plugins', { paths })) as ScanResult };
}
