/**
 * Marks a mouse drag as in progress on the document element so a component that
 * must not steal its Escape (the open virtual keyboard) can detect it without
 * importing the module that owns the drag. A DOM attribute rather than module
 * state keeps the marker readable by any surface and visible in E2E. The value
 * counts overlapping drags so one ending never hides another still running.
 */
const ACTIVE_DRAG_ATTRIBUTE = 'data-drag-gesture-active';

const readActiveDragCount = (): number => Number(document.documentElement.getAttribute(ACTIVE_DRAG_ATTRIBUTE) ?? '0');

/** Records a drag as active. The returned function ends it and is safe to call twice. */
export const beginDragGesture = (): (() => void) => {
    document.documentElement.setAttribute(ACTIVE_DRAG_ATTRIBUTE, String(readActiveDragCount() + 1));
    let ended = false;
    return () => {
        if (ended) {
            return;
        }
        ended = true;
        const remaining = readActiveDragCount() - 1;
        if (remaining > 0) {
            document.documentElement.setAttribute(ACTIVE_DRAG_ATTRIBUTE, String(remaining));
            return;
        }
        document.documentElement.removeAttribute(ACTIVE_DRAG_ATTRIBUTE);
    };
};

export const isDragGestureActive = (): boolean => readActiveDragCount() > 0;

/**
 * Whether a keydown is the Escape that cancels a live drag: unmodified and not an auto-repeat.
 * A held key's repeat must not kill a drag begun while it is still down, and Shift/Ctrl/Alt/Meta
 * + Escape belongs to other shortcuts. The global shortcut layer ignores repeat for the same reason,
 * so every drag owner shares this one rule.
 */
export const isDragCancelEscape = (event: KeyboardEvent): boolean =>
    event.key === 'Escape' && !event.repeat && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
