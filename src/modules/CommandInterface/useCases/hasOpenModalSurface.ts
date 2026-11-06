/**
 * Surfaces that open over the workspace and close on Escape. A bare listbox is not one:
 * persistent lists (the sample library, agent runs) use that role while always mounted,
 * so only a listbox inside a popper (an open select) counts. The popper wrapper alone is
 * not enough either: it also wraps tooltips, which never own Escape. Popover and dropdown
 * content carry the dialog and menu roles already matched here.
 */
export const TRANSIENT_SURFACE_SELECTOR =
    '[role="dialog"], [role="alertdialog"], [role="menu"], [data-radix-popper-content-wrapper] [role="listbox"]';

/**
 * True when any open dialog, menu or popup exists in the document, wherever focus
 * is. `except` is a surface that must not count, such as the one hosting the caller.
 */
export function hasOpenModalSurface(except: Element | null = null): boolean {
    return [...document.querySelectorAll(TRANSIENT_SURFACE_SELECTOR)].some(
        (surface) => except === null || !surface.contains(except)
    );
}
