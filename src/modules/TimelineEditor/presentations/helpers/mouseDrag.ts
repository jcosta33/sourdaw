/**
 * Attaches global mousemove + mouseup listeners and tears them down on the
 * first mouseup. Eliminates the repeated add/remove boilerplate across every
 * inline drag handler in a component.
 *
 * Escape cancels the gesture (listeners removed, `onUp` never called — there
 * is nothing to commit). The returned `cancel` lets an owning component tear
 * the listeners down from elsewhere too, e.g. its own unmount cleanup when it
 * disappears mid-drag (a lane deleted while a point on it is being dragged).
 * Teardown is idempotent so a caller-initiated cancel and a normal mouseup
 * racing each other can never double-remove or double-fire.
 */
export const startMouseDrag = (onMove: (e: MouseEvent) => void, onUp: (e: MouseEvent) => void): (() => void) => {
    let tornDown = false;

    const teardown = (): void => {
        if (tornDown) {
            return;
        }
        tornDown = true;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', handleUp);
        window.removeEventListener('keydown', handleKeyDown);
    };

    const handleUp = (event: MouseEvent): void => {
        teardown();
        onUp(event);
    };

    const handleKeyDown = (event: KeyboardEvent): void => {
        if (event.key !== 'Escape') {
            return;
        }
        teardown();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleUp);
    window.addEventListener('keydown', handleKeyDown);

    return teardown;
};
