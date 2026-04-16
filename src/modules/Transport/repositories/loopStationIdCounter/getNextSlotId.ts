/**
 * Loop station ID counters — single source of truth for slot/layer IDs.
 * All use cases that create loop slots or layers must use these counters.
 */

export function getNextSlotId(): string {
    return `loop-${crypto.randomUUID()}`;
}