import { downloadBlob } from '#/utils/downloadFile';

type DownloadGrinderNeuralModelFileInput = {
    file_name: string;
    file_text: string;
};

export function downloadGrinderNeuralModelFile(input: DownloadGrinderNeuralModelFileInput): void {
    downloadBlob(input.file_text, input.file_name, 'application/json');
}
