import { downloadBlob } from '#/utils/downloadFile';

export function downloadHardwareMappingsFile(json: string, filename: string): void {
    downloadBlob(json, filename, 'application/json');
}
