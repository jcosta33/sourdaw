export type ActionHistoryMetadata = {
    id: string;
    label: string;
    actionKind: string;
    source: 'manual' | 'prompt' | 'voice' | 'ai';
    timestamp: number;
    groupId?: string;
    groupLabel?: string;
    reverted: boolean;
};

export type ActionHistoryMetadataPort = {
    record: (entry: ActionHistoryMetadata) => string[];
    markReverted: (entryId: string) => void;
    clear: () => void;
};

const no_action_history_metadata_port: ActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => undefined,
    clear: () => undefined,
};

let action_history_metadata_port: ActionHistoryMetadataPort = no_action_history_metadata_port;

export function setActionHistoryMetadataPort(port: ActionHistoryMetadataPort): void {
    action_history_metadata_port = port;
}

export const actionHistoryMetadataPort: ActionHistoryMetadataPort = {
    record: (entry) => action_history_metadata_port.record(entry),
    markReverted: (entryId) => action_history_metadata_port.markReverted(entryId),
    clear: () => action_history_metadata_port.clear(),
};
