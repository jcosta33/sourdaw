import { tauriInvoke, isTauri } from '#/helpers/tauriBridge';
import { type ScanResult } from './types';

export async function scanPlugins(paths: string[]): Promise<ScanResult> {
    if (!isTauri()) {
        return { plugins: [], errors: ['Plugin scanning requires the desktop app'], scan_duration_ms: 0 };
    }
    return tauriInvoke('scan_plugins', { paths }) as Promise<ScanResult>;
}
