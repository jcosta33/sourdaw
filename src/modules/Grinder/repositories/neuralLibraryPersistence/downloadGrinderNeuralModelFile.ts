type DownloadGrinderNeuralModelFileInput = {
    file_name: string;
    file_text: string;
};

export function downloadGrinderNeuralModelFile(input: DownloadGrinderNeuralModelFileInput): void {
    const blob = new Blob([input.file_text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = input.file_name;
    anchor.click();
    // Revoking the object URL synchronously after click() cancels in-flight
    // downloads of large blobs: the browser has not started reading the blob
    // when click() returns. Defer the revoke to a later task so the download can
    // complete, while still releasing the URL.
    setTimeout(() => {
        URL.revokeObjectURL(url);
    }, 0);
}
