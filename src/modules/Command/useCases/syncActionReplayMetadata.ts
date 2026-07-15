import { syncActionReplayCapabilityMetadata } from '../stores/actionReplayCapabilities';

type SyncActionReplayMetadataInput = readonly {
    id: string;
    label: string;
    actionKind: string;
    source: 'manual' | 'prompt' | 'voice' | 'ai';
    timestamp: number;
    groupId?: string;
    groupLabel?: string;
}[];

export function syncActionReplayMetadata(entries: SyncActionReplayMetadataInput): void {
    syncActionReplayCapabilityMetadata(entries);
}
