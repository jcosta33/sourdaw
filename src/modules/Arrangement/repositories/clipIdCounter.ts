/**
 * Single source of truth for generating clip IDs.
 * All use cases that create clips must use this counter.
 *
 * Uses crypto.randomUUID() to avoid ID collisions when loading
 * persisted projects (sequential counters reset on HMR/reload).
 */
export function getNextClipId(): string {
    // Use the full 122-bit UUID rather than the first 8 hex chars (32 bits):
    // truncating invited birthday collisions around ~65k clips in a project.
    return `clip-${crypto.randomUUID()}`;
}
