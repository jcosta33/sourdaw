/**
 * Setlist item ID counter — single source of truth.
 * All use cases that create setlist items must use this counter.
 */

let itemId = 1;

export function getNextSetlistItemId(): string {
    return `sli-${itemId++}`;
}

export const SETLIST_ITEM_COLORS = [
    'oklch(0.42 0.08 200)',
    'oklch(0.42 0.08 140)',
    'oklch(0.42 0.08 280)',
    'oklch(0.42 0.08 340)',
    'oklch(0.42 0.08 60)',
    'oklch(0.42 0.08 20)',
];
