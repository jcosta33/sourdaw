import { desktopInvoke, isDesktopRuntime } from '#/utils/desktopBridge';

import { type ScanResult } from './types';

export async function scanPlugins(paths: string[]): Promise<ScanResult> {
    if (!isDesktopRuntime()) {
        return { plugins: [], errors: ['Plugin scanning requires the desktop app'], scan_duration_ms: 0 };
    }
    return desktopInvoke('scan_plugins', { paths }) as Promise<ScanResult>;
}
