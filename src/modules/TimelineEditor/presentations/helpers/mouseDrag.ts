import { beginDragGesture } from '#/utils/UI/activeDragGesture';

/**
 * Attaches global mousemove + mouseup listeners and tears them down on the
 * first mouseup. Eliminates the repeated add/remove boilerplate across every
 * inline drag handler in a component.
 *
 * Escape cancels the gesture: listeners are removed and `onCancel` runs
 * instead of `onUp`. This is not a no-op teardown — a gesture that mutates
 * live state in `onMove` (e.g. writing straight to a CRDT-backed store on
 * every move, as the automation drags do) needs `onCancel` to revert that
 * partial mutation, or Escape leaves it permanently applied with no undo
 * entry. The returned function lets an owning component cancel the gesture
 * from elsewhere too, e.g. its own unmount cleanup when it disappears
 * mid-drag (a lane deleted while a point on it is being dragged) — it runs
 * the same `onCancel` path, not a bare listener removal. Teardown is
 * idempotent so a caller-initiated cancel and a normal mouseup racing each
 * other can never double-remove or double-fire.
 *
 * Losing window focus ends the gesture too. A button released while another
 * app has focus delivers no mouseup here, so without this the drag would stay
 * marked, follow the pointer with the button up once the user returns, and
 * take their next Escape. Blur keeps what the user dragged to by running
 * `onUp` with the last mousemove (a mouseup at that spot), or `onCancel` when
 * the pointer never moved — the same commit-on-blur rule the piano-roll lane
 * drags follow. `onUp` must therefore read only what a mousemove also carries.
 */
export const startMouseDrag = (
    onMove: (e: MouseEvent) => void,
    onUp: (e: MouseEvent) => void,
    onCancel?: () => void
): (() => void) => {
    let tornDown = false;
    let lastMove: MouseEvent | null = null;
    const endDragGesture = beginDragGesture();

    const removeListeners = (): void => {
        endDragGesture();
        window.removeEventListener('mousemove', handleMove);
        window.removeEventListener('mouseup', handleUp);
        window.removeEventListener('keydown', handleKeyDown);
        window.removeEventListener('blur', handleBlur);
    };

    const handleMove = (event: MouseEvent): void => {
        lastMove = event;
        onMove(event);
    };

    const cancel = (): void => {
        if (tornDown) {
            return;
        }
        tornDown = true;
        removeListeners();
        onCancel?.();
    };

    const handleUp = (event: MouseEvent): void => {
        if (tornDown) {
            return;
        }
        tornDown = true;
        removeListeners();
        onUp(event);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
            return;
        }
        cancel();
    };

    const handleBlur = (): void => {
        if (!lastMove) {
            cancel();
            return;
        }
        handleUp(lastMove);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('blur', handleBlur);

    return cancel;
};
