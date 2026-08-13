import {
    VERSIONED_COMMAND_SCHEMA_VERSION,
    type VersionedCommandEnvelope,
    type VersionedCommandReceipt,
} from '../models/VersionedCommandEnvelope';

type CreateVersionedCommandReceiptInput = {
    envelope: VersionedCommandEnvelope;
    applicationAssignedIds?: readonly string[];
    compensation?: VersionedCommandReceipt['compensation'];
};

export function createVersionedCommandReceipt(input: CreateVersionedCommandReceiptInput): VersionedCommandReceipt {
    return {
        commandId: input.envelope.commandId,
        schemaVersion: VERSIONED_COMMAND_SCHEMA_VERSION,
        applicationAssigned: {
            ids: [
                { field: 'commandId', value: input.envelope.commandId },
                ...input.envelope.applicationAssignedIds.map(({ value }) => ({ field: 'objectId' as const, value })),
                ...(input.applicationAssignedIds ?? []).map((value) => ({ field: 'historyId' as const, value })),
            ],
            timestamps: [{ field: 'issuedAt', value: input.envelope.issuedAt }],
        },
        ...(input.compensation ? { compensation: input.compensation } : {}),
    };
}
