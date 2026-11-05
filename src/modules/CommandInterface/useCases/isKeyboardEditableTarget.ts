/**
 * Focus classifier for surfaces that consume typed characters: text fields and
 * contenteditable. A canvas editor is deliberately not one; it claims the keys
 * it handles with `preventDefault` instead of taking the whole keyboard.
 */
export function isKeyboardEditableTarget(target: Element | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable === true)
    );
}
