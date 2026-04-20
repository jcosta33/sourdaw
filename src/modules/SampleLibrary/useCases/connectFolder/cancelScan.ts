import { getScanAbortController } from './helpers';

export function cancelScan(): void {
    getScanAbortController()?.abort();
}
