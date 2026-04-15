/**
 * OPFS storage status for the model manager.
 */

export type StorageStatus = {
    /** Total bytes used by cached models */
    usedBytes: number;
    /** Configured cache limit in bytes (default 2 GB) */
    limitBytes: number;
    /** Whether navigator.storage.persist() has been called and granted */
    persisted: boolean;
    /** Estimated available quota from navigator.storage.estimate() */
    availableBytes: number | null;
};

export const DEFAULT_CACHE_LIMIT_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB
