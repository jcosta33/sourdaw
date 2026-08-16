/**
 * How long the object URL stays resolvable after the click.
 *
 * A next-tick revoke only guarantees the click handler has returned; it does
 * not guarantee the browser has started reading the blob, and a large export
 * revoked mid-read saves nothing. Matches the project-export anchor path
 * (`Project/repositories/project/downloadProjectFile.ts`).
 */
const OBJECT_URL_LIFETIME_MS = 1000;

/**
 * Repository: Browser file download helper.
 * Wraps Blob creation, URL.createObjectURL, and anchor-based downloads.
 */
export function downloadBlob(data: BlobPart, filename: string, mimeType: string): void {
    const blob = new Blob([data], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const alpha = document.createElement('a');
    alpha.href = url;
    alpha.download = filename;
    // A detached anchor is not guaranteed to dispatch a navigation, and
    // revoking the object URL in the same task can race a download that only
    // resolves the URL afterwards — either way the user gets nothing and no
    // error. Attach, click, then detach and revoke on a later task.
    alpha.style.display = 'none';
    document.body.append(alpha);
    alpha.click();
    setTimeout(() => {
        alpha.remove();
        URL.revokeObjectURL(url);
    }, OBJECT_URL_LIFETIME_MS);
}
