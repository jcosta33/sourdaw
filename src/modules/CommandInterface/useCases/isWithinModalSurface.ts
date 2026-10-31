// A focused dialog / alertdialog / menu / listbox surface owns the keyboard:
// keydowns from inside it stay in the surface, not the app shortcuts (#3618).
const MODAL_SURFACE_SELECTOR = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]';

/** True when the event target sits inside an open modal or menu surface. */
export function isWithinModalSurface(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(MODAL_SURFACE_SELECTOR) !== null;
}
