type KeyboardScrollInput = { scrollX: number; maxScrollX: number; pixelsPerBeat: number; viewportWidth: number };

/**
 * The scroll a key moves the thumb by: a beat for an arrow, as a nudge on the
 * timeline does, a viewport for Page Up/Down, and the ends for Home and End.
 * `null` leaves every other key to the window shortcut layer.
 */
export const getKeyboardScrollTarget = (
    key: string,
    { scrollX, maxScrollX, pixelsPerBeat, viewportWidth }: KeyboardScrollInput
): number | null => {
    switch (key) {
        case 'ArrowLeft':
            return scrollX - pixelsPerBeat;
        case 'ArrowRight':
            return scrollX + pixelsPerBeat;
        case 'PageUp':
            return scrollX - viewportWidth;
        case 'PageDown':
            return scrollX + viewportWidth;
        case 'Home':
            return 0;
        case 'End':
            return maxScrollX;
        default:
            return null;
    }
};
