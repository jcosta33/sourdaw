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
    recordBatch?: (entries: readonly ActionHistoryMetadata[]) => string[];
    markReverted: (input: { entryId: string; expectedFingerprint: string }) => {
        status: 'marked' | 'unavailable';
    };
    clear: () => void;
};

const no_action_history_metadata_port: ActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' }),
    clear: () => undefined,
};

let action_history_metadata_port: ActionHistoryMetadataPort = no_action_history_metadata_port;

export function setActionHistoryMetadataPort(port: ActionHistoryMetadataPort): void {
    action_history_metadata_port = port;
}

export const actionHistoryMetadataPort: ActionHistoryMetadataPort & {
    recordBatch: (entries: readonly ActionHistoryMetadata[]) => string[];
} = {
    record: (entry) => action_history_metadata_port.record(entry),
    recordBatch: (entries) => {
        const recordBatch = action_history_metadata_port.recordBatch;
        if (recordBatch) {
            return recordBatch(entries);
        }
        const evictedEntryIds: string[] = [];
        for (const entry of entries) {
            evictedEntryIds.push(...action_history_metadata_port.record(entry));
        }
        return evictedEntryIds;
    },
    markReverted: (input) => action_history_metadata_port.markReverted(input),
    clear: () => action_history_metadata_port.clear(),
};
