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
    }, 0);
}
