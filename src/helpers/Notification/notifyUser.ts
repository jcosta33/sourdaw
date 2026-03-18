export function notifyUser(message: string, level: 'info' | 'warning' | 'error' = 'info'): void {
    document.dispatchEvent(
        new CustomEvent('webdaw:notify', {
            detail: { message, level },
        })
    );
}
