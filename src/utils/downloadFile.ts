/**
 * How long the object URL stays resolvable after the click.
 *
 * A next-tick revoke only guarantees the click handler has returned; it does
 * not guarantee the browser has started reading the blob, and a large export
 * revoked mid-read saves nothing.
 */
export const OBJECT_URL_LIFETIME_MS = 1000;

/**
 * Browser file download helper.
 * Wraps Blob creation (if needed), URL.createObjectURL, anchor creation,
 * document attachment, click dispatch, and deferred cleanup.
 */
export function downloadBlob(data: Blob | BlobPart, filename: string, mimeType?: string): void {
    const blob =
        data instanceof Blob ? data : new Blob([data], mimeType !== undefined ? { type: mimeType } : undefined);
    const url = URL.createObjectURL(blob);
    const alpha = document.createElement('a');
    alpha.href = url;
    alpha.download = filename;
    alpha.style.display = 'none';
    document.body.appendChild(alpha);
    alpha.click();
    setTimeout(() => {
        if (alpha.parentNode) {
            alpha.parentNode.removeChild(alpha);
        } else if (alpha.remove) {
            alpha.remove();
        } else {
            document.body?.removeChild?.(alpha);
        }
        URL.revokeObjectURL(url);
    }, OBJECT_URL_LIFETIME_MS);
}
