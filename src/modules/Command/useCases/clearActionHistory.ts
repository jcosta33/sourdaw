import { clearActionReplayCapabilities } from '../stores/actionReplayCapabilities';

import { actionHistoryMetadataPort } from './actionHistoryMetadataPort';

export function clearActionHistory(): void {
    try {
        actionHistoryMetadataPort.clear();
    } finally {
        clearActionReplayCapabilities();
    }
}
