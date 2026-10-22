import { statfsSync } from 'node:fs';

export function availableDiskBytes(path: string): number | undefined {
    try {
        const stats = statfsSync(path, { bigint: true });
        const bytes = Number(stats.bavail * stats.bsize);
        return Number.isFinite(bytes) && bytes >= 0 ? bytes : undefined;
    } catch {
        return undefined;
    }
}

export function diskStorageFailure(
    paths: readonly string[],
    reserveBytes: number,
    sampler: (path: string) => number | undefined = availableDiskBytes
): { reason: 'monitor' | 'pressure'; message: string } | undefined {
    for (const path of new Set(paths)) {
        let available: number | undefined;
        try {
            available = sampler(path);
        } catch {
            available = undefined;
        }
        if (available === undefined || !Number.isFinite(available) || available < 0) {
            return { reason: 'monitor', message: `available disk space could not be measured: ${path}` };
        }
        if (available < reserveBytes) {
            return {
                reason: 'pressure',
                message: `available disk space below ${Math.ceil(reserveBytes / 1024 ** 2)} MiB reserve: ${path} (${Math.floor(available / 1024 ** 2)} MiB available)`,
            };
        }
    }
    return undefined;
}
