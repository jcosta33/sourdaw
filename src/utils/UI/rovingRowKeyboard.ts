import { type KeyboardEvent } from 'react';

type RovingRowAxis = 'vertical' | 'horizontal';

const NEIGHBOUR_KEYS: Record<RovingRowAxis, { previous: string; next: string }> = {
    vertical: { previous: 'ArrowUp', next: 'ArrowDown' },
    horizontal: { previous: 'ArrowLeft', next: 'ArrowRight' },
};

/**
 * Keyboard operation for a focusable row of a roving-tabindex grid whose rows
 * are DOM siblings: the arrows along `axis` move focus to the neighbouring row,
 * and Enter or Space activates the focused row as a click on it does. Keys
 * typed into a control inside the row stay with that control.
 *
 * A handled key is claimed, so Space does not also toggle transport play and
 * Enter does not also stop it in the window shortcut layer.
 */
export const handleRovingRowKeyDown = (
    event: KeyboardEvent<HTMLElement>,
    axis: RovingRowAxis,
    onActivate: () => void
): void => {
    if (event.target !== event.currentTarget) {
        return;
    }
    const keys = NEIGHBOUR_KEYS[axis];
    if (event.key === keys.previous || event.key === keys.next) {
        event.preventDefault();
        event.stopPropagation();
        const row = event.currentTarget;
        const neighbour = event.key === keys.next ? row.nextElementSibling : row.previousElementSibling;
        if (neighbour instanceof HTMLElement && neighbour.getAttribute('role') === 'row') {
            neighbour.focus();
        }
        return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        onActivate();
    }
};
