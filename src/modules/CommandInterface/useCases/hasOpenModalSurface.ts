import { MODAL_SURFACE_SELECTOR } from './isWithinModalSurface';

/**
 * True when any open modal or menu surface exists in the document, wherever focus
 * is. `except` is a surface that must not count, such as the one hosting the caller.
 */
export function hasOpenModalSurface(except: Element | null = null): boolean {
    return [...document.querySelectorAll(MODAL_SURFACE_SELECTOR)].some(
        (surface) => except === null || !surface.contains(except)
    );
}
