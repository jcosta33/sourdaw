/**
 * Single source of truth for generating clip IDs.
 * All use cases that create clips must use this counter.
 *
 * Uses crypto.randomUUID() to avoid ID collisions when loading
 * persisted projects (sequential counters reset on HMR/reload).
 */
export function getNextClipId(): string {
    return `clip-${crypto.randomUUID().slice(0, 8)}`;
}
