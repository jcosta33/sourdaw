/**
 * Setlist item ID counter and color palette — shared by setlist use cases.
 */

let itemId = 1;

export function getNextSetlistItemId(): string {
    return `sli-${itemId++}`;
}

export const SETLIST_ITEM_COLORS = [
    'oklch(0.42 0.08 200)', 'oklch(0.42 0.08 140)', 'oklch(0.42 0.08 280)',
    'oklch(0.42 0.08 340)', 'oklch(0.42 0.08 60)', 'oklch(0.42 0.08 20)',
];
