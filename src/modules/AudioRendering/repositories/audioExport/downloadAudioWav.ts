const OBJECT_URL_LIFETIME_MS = 1000;

export function downloadAudioWav(bytes: ArrayBuffer, filename: string): void {
    const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/wav' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    setTimeout(() => {
        link.remove();
        URL.revokeObjectURL(url);
    }, OBJECT_URL_LIFETIME_MS);
}
