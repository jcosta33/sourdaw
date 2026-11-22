import { type ApplicationToolReceipt } from '../models/ApplicationOwnedTool';

export type ApplicationToolOnlyPlanInput = {
    runId: string;
    revision: string;
    receipts: readonly ApplicationToolReceipt[];
};

/** The evidence write for a run that read the project and planned nothing to change. */
export function readApplicationToolOnlyEvidence(input: ApplicationToolOnlyPlanInput) {
    return {
        runId: input.runId,
        summary: input.receipts
            .map((receipt) => `${receipt.toolName} (${receipt.callId}) ${receipt.status}: ${receipt.summary}`)
            .join('\n'),
        applicationToolReceipts: [...input.receipts],
        revision: input.revision,
        scope: {
            targetIds: [],
            targetRanges: [],
            protectedTargetIds: [],
            protectedRanges: [],
        },
        grants: {
            allowedOperationPrefixes: [],
            create: false,
            delete: false,
            routing: false,
            tempo: false,
            master: false,
            file: false,
            audioUpload: false,
            remoteGeneration: false,
            autoCommit: false,
        },
        budgets: { limits: {}, consumed: {} },
    };
}
