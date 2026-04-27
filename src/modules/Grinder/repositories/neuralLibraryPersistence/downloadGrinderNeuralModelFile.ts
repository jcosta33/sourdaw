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
    URL.revokeObjectURL(url);
}
