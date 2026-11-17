/** Identifies a floating device control after text entry and nested surfaces take priority. */
export function isDeviceEditorControlTarget(target: EventTarget | null): boolean {
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
