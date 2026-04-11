import { scanAbortController } from './helpers';

export function cancelScan(): void {
    if (scanAbortController) {
        scanAbortController.abort();
    }
}