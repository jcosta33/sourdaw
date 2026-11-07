import { TRANSIENT_SURFACE_SELECTOR } from './hasOpenModalSurface';

/**
 * True when the event target sits inside a surface that opens over the workspace and owns the
 * keyboard while open. Unlike `isWithinModalSurface`, an always-mounted listbox does not count.
 */
export function isWithinTransientSurface(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(TRANSIENT_SURFACE_SELECTOR) !== null;
}
