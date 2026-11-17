/** The nearest surface owns history. Text entry and nested popups keep their own Undo. */
export function isDeviceEditorHistoryTarget(target: EventTarget | null): boolean {
    if (!(target instanceof Element) || (target instanceof HTMLElement && target.isContentEditable)) {
        return false;
    }
    if (
        target.closest(
            'textarea, select, [contenteditable="true"], [role="textbox"], [role="combobox"], [aria-haspopup]:not([aria-haspopup="false"])[aria-expanded="true"], [data-canvas-editor]'
        )
    ) {
        return false;
    }
    if (target instanceof HTMLInputElement && !['range', 'checkbox', 'radio', 'button'].includes(target.type)) {
        return false;
    }
    const surface = target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]');
    return surface?.matches('[role="dialog"][data-device-editor][aria-modal="false"]') === true;
}
