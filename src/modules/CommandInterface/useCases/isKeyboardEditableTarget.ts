/** Shared focus classifier for global shortcuts and native Edit routing. */
export function isKeyboardEditableTarget(target: Element | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && (target.isContentEditable || target.closest('[data-canvas-editor]') !== null))
    );
}
