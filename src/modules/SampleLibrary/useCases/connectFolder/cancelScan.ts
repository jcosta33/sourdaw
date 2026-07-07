import { getScanAbortController } from './getScanAbortController';

export function cancelScan(): void {
    getScanAbortController()?.abort();
}
