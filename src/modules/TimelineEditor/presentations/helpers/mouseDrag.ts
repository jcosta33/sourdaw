/**
 * Attaches global mousemove + mouseup listeners and tears them down on the
 * first mouseup. Eliminates the repeated add/remove boilerplate across every
 * inline drag handler in a component.
 */
export const startMouseDrag = (onMove: (e: MouseEvent) => void, onUp: (e: MouseEvent) => void): void => {
    const handleUp = (event: MouseEvent) => {
        onUp(event);
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', handleUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', handleUp);
};
