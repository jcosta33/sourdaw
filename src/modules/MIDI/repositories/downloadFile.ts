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
    alpha.click();
    URL.revokeObjectURL(url);
}
