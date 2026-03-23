/**
 * Single source of truth for generating clip IDs.
 * All use cases that create clips must use this counter.
 */
let nextClipId = 1;

export function getNextClipId(): string {
    return `clip-${nextClipId++}`;
}
