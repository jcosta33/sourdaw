/**
 * Loop station ID counters — shared by loop station use cases.
 */

let slotId = 1;
let layerId = 1;

export function getNextSlotId(): string {
    return `loop-${slotId++}`;
}

export function getNextLayerId(): string {
    return `layer-${layerId++}`;
}
