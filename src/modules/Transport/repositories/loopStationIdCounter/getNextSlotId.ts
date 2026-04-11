/**
 * Loop station ID counters — single source of truth for slot/layer IDs.
 * All use cases that create loop slots or layers must use these counters.
 */

let slotId = 1;

export function getNextSlotId(): string {
    return `loop-${slotId++}`;
}