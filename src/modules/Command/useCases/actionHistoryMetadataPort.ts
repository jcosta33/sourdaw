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

let action_history_metadata_port: ActionHistoryMetadataPort | null = null;

export function setActionHistoryMetadataPort(port: ActionHistoryMetadataPort): void {
    action_history_metadata_port = port;
}

/**
 * Reading before `registerCorePorts()` in `src/app/bootstrap.ts` fills it
 * throws: a history entry that was not recorded could never be reverted.
 */
function readFilledPort(caller: string): ActionHistoryMetadataPort {
    if (action_history_metadata_port === null) {
        throw new Error(
            `actionHistoryMetadataPort.${caller}: no action history port is registered; call setActionHistoryMetadataPort() from registerCorePorts() in src/app/bootstrap.ts`
        );
    }
    return action_history_metadata_port;
}

export const actionHistoryMetadataPort: ActionHistoryMetadataPort & {
    recordBatch: (entries: readonly ActionHistoryMetadata[]) => string[];
} = {
    record: (entry) => readFilledPort('record').record(entry),
    recordBatch: (entries) => {
        const port = readFilledPort('recordBatch');
        if (port.recordBatch) {
            return port.recordBatch(entries);
        }
        const evictedEntryIds: string[] = [];
        for (const entry of entries) {
            evictedEntryIds.push(...port.record(entry));
        }
        return evictedEntryIds;
    },
    markReverted: (input) => readFilledPort('markReverted').markReverted(input),
    clear: () => readFilledPort('clear').clear(),
};
