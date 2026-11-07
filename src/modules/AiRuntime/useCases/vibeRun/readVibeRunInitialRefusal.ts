import { digest } from '#/utils/canonicalDigest';

import { type PlannedAgentRunBatchSchedule } from '../../models/AgentRun';
import { APPLICATION_TOOL_RECEIPT_MAX_BYTES, type ApplicationToolReceipt } from '../../models/ApplicationOwnedTool';
import { type VibeRunInitialBaselineRefusal } from '../../models/VibeRunPlan';
import { readVibeRunInitialReceipt } from '../../validators/readVibeRunInitialReceipt';
import { metricGoalStateCodec } from '../metricGoalStateCodec';

function record(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function failure(receipt: ApplicationToolReceipt): boolean {
    return (
        receipt.schema === 'sourdaw.application-tool-receipt' &&
        receipt.schemaVersion === 1 &&
        receipt.status === 'failure' &&
        receipt.revision === null &&
        receipt.data === null &&
        typeof receipt.callId === 'string' &&
        receipt.callId.length > 0 &&
        typeof receipt.summary === 'string' &&
        Array.isArray(receipt.warnings) &&
        receipt.warnings.every((warning) => typeof warning === 'string') &&
        record(receipt.error) &&
        typeof receipt.error.code === 'string' &&
        receipt.error.code !== 'cancelled' &&
        receipt.error.code !== 'stale-revision' &&
        typeof receipt.error.safeMessage === 'string' &&
        typeof receipt.error.retryable === 'boolean'
    );
}

type RefusalInput = {
    metadata: VibeRunInitialBaselineRefusal | undefined;
    revision: string;
    receipts: readonly ApplicationToolReceipt[];
    actions: readonly { type: string }[];
    metricGoalState: string | undefined;
    batchSchedule: PlannedAgentRunBatchSchedule | undefined;
    scheduledCommandCount: number | undefined;
};

function readMetadata(value: unknown, revision: string): VibeRunInitialBaselineRefusal | null {
    if (
        !record(value) ||
        new TextEncoder().encode(JSON.stringify(value)).byteLength > APPLICATION_TOOL_RECEIPT_MAX_BYTES ||
        Object.keys(value).some(
            (key) => !['schemaVersion', 'sourceRevision', 'stage', 'receiptCallIds'].includes(key)
        ) ||
        value.schemaVersion !== 1 ||
        value.sourceRevision !== revision ||
        (value.stage !== 'preflight' && value.stage !== 'collection') ||
        !Array.isArray(value.receiptCallIds) ||
        !value.receiptCallIds.every((id) => typeof id === 'string' && id.length > 0)
    ) {
        return null;
    }
    const ids = new Set<string>(value.receiptCallIds);
    if (ids.size !== value.receiptCallIds.length || (value.stage === 'preflight' ? ids.size !== 0 : ids.size === 0)) {
        return null;
    }
    return { schemaVersion: 1, sourceRevision: revision, stage: value.stage, receiptCallIds: [...ids] };
}
function validOptionalReceipt(receipt: ApplicationToolReceipt, revision: string): boolean {
    if (
        receipt.origin !== 'application-verification' ||
        receipt.turn !== 0 ||
        receipt.toolName !== 'analysis.measure' ||
        new TextEncoder().encode(JSON.stringify(receipt)).byteLength > APPLICATION_TOOL_RECEIPT_MAX_BYTES
    ) {
        return false;
    }
    if (receipt.status === 'success') {
        const measured = readVibeRunInitialReceipt(receipt);
        return (
            measured !== null &&
            measured.revision === revision &&
            measured.data.sourceRevisionDigest === digest(revision)
        );
    }
    return failure(receipt);
}

/** Classifies exact optional initial reads for one soundless brief; every other prerequisite still holds. */
export function readVibeRunInitialRefusal(input: RefusalInput): ReadonlySet<string> | null {
    const metadata = readMetadata(input.metadata, input.revision);
    const state = metricGoalStateCodec(input.metricGoalState);
    if (
        metadata === null ||
        input.actions.length !== 1 ||
        input.actions[0]?.type !== 'setProductionBrief' ||
        input.batchSchedule !== undefined ||
        input.scheduledCommandCount !== undefined ||
        state === null ||
        state.authorities.some((authority) => authority.kind !== 'literal' && authority.goals.length > 0)
    ) {
        return null;
    }
    const ids = new Set(metadata.receiptCallIds);
    for (const callId of ids) {
        const matches = input.receipts.filter((receipt) => receipt.callId === callId);
        const receipt = matches[0];
        if (matches.length !== 1 || receipt === undefined || !validOptionalReceipt(receipt, input.revision)) {
            return null;
        }
    }
    if (input.receipts.some((receipt) => receipt.status === 'failure' && !ids.has(receipt.callId))) {
        return null;
    }
    return ids;
}
