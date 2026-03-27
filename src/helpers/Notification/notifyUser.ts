export function notifyUser(message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info'): void {
    document.dispatchEvent(
        new CustomEvent('sourdaw:notify', {
            detail: { message, level },
        })
    );
}
