import { VERSIONED_COMMAND_BATCH_SCHEMA_VERSION } from '../models/VersionedCommandBatchEnvelope';

import { VERIFIED_BATCH_RECEIPT_SCHEMA_VERSION } from './createVerifiedBatchReceipt';
import { executableAppActionDescriptors } from './executableAppActionRegistry';
import { getExecutableAppActionOperationVersion } from './getExecutableAppActionOperationVersion';

export function getCommandProtocolContracts() {
    const operations = executableAppActionDescriptors.map((descriptor) => ({
        name: descriptor.actionType,
        version: String(getExecutableAppActionOperationVersion(descriptor.actionType)),
        availability: 'available' as const,
    }));

    return {
        command: {
            id: 'command' as const,
            owner: 'Command' as const,
            schemaVersion: VERSIONED_COMMAND_BATCH_SCHEMA_VERSION,
            capabilities: [
                'versioned-envelope',
                'atomic-batch',
                'exact-approval-binding',
                'typed-compensation',
            ] as const,
            operations,
            availability: 'available' as const,
            compatibility: {
                mode: 'discard-retired' as const,
                behavior: 'Reject unsupported schemas and discard retired actions during history hydration.',
                canonicalProjectRequiresCommandReplay: false as const,
            },
        },
        receipt: {
            id: 'receipt' as const,
            owner: 'Command' as const,
            schemaVersion: VERIFIED_BATCH_RECEIPT_SCHEMA_VERSION,
            capabilities: ['verified-outcome', 'semantic-diff', 'compensation-status', 'revision-heads'] as const,
            operations: [
                {
                    name: 'verified-batch-receipt',
                    version: String(VERIFIED_BATCH_RECEIPT_SCHEMA_VERSION),
                    availability: 'available' as const,
                },
            ],
            availability: 'available' as const,
            compatibility: {
                mode: 'read-only-preserve' as const,
                behavior: 'Preserve supported receipts as immutable evidence; reject malformed stored receipts.',
                canonicalProjectRequiresCommandReplay: false as const,
            },
        },
    };
}
