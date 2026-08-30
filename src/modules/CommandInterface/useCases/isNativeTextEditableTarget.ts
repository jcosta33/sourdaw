/** Native responder editing applies only to DOM text-editing surfaces. */
export function isNativeTextEditableTarget(target: Element | null): boolean {
    return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
    );
}
