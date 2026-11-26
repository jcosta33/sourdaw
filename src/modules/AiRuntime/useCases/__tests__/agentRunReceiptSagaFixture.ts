import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { registerHandlerMap } from '#/modules/Command/stores';
import {
    compileVersionedCommandBatchEnvelope,
    createVerifiedBatchReceipt,
    createVersionedCommandReceipt,
    getVersionedCommandBatchCommitProof,
    parseVersionedCommandBatchEnvelope,
} from '#/modules/Command/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { compilePendingActionCommandEnvelopes } from '../compilePendingActionCommandEnvelopes';
import { type AgentRunReceiptSagaInput } from '../projectAgentRunReceiptSaga';

export const SAGA_RUN_ID = 'run-receipt-saga';
const BASE_REVISION = JSON.stringify({
    documentIdentityEpoch: 1,
    mutationEpoch: 0,
    documents: [{ docId: 'root', heads: ['head-0'] }],
});

const ACTIONS = [
    {
        type: 'addDevice',
        payload: { deviceId: 'device-compressor-1', trackId: 'track-vocal', deviceType: 'builtin-compressor' },
    },
] satisfies readonly [Extract<AppAction, { type: 'addDevice' }>];

registerHandlerMap({ addDevice: getArrangementHandlers().addDevice });

const COMMAND_BATCH = compileVersionedCommandBatchEnvelope({
    runId: SAGA_RUN_ID,
    batchId: 'batch-receipt-saga',
    projectId: 'project-receipt-saga',
    baseRevision: BASE_REVISION,
    intent: 'Add the vocal compressor.',
    commands: compilePendingActionCommandEnvelopes({
        actions: ACTIONS,
        actionLabels: ['Add the approved compressor to the vocal track.'],
        group: { groupId: 'batch-receipt-saga', groupLabel: 'Add the vocal compressor.' },
        projectRevision: BASE_REVISION,
    }),
    mode: 'commit',
});

const parsed = parseVersionedCommandBatchEnvelope(COMMAND_BATCH.serialized, COMMAND_BATCH.authority);
if (parsed.status === 'invalid') {
    throw new Error(parsed.reason);
}
const COMMAND_ENVELOPE = parsed.envelope;

/** A committed, effect-free batch receipt for the run, in the shape the receipt saga records. */
export async function createReceiptSagaInput(): Promise<AgentRunReceiptSagaInput> {
    const proof = await getVersionedCommandBatchCommitProof(COMMAND_BATCH);
    const actions = COMMAND_ENVELOPE.commands.map((command) => ({
        action: ACTIONS[0],
        receipt: createVersionedCommandReceipt({
            envelope: command,
            compensation: { available: true, strategy: 'inverse' },
        }),
    }));
    return {
        runId: SAGA_RUN_ID,
        receipt: createVerifiedBatchReceipt({
            contentHash: proof.contentHash,
            envelope: COMMAND_ENVELOPE,
            observedBaseRevision: BASE_REVISION,
            resultingRevision: BASE_REVISION,
            result: { status: 'committed', actions },
        }),
        actions: ACTIONS,
        revertGroupId: 'batch-receipt-saga',
        committedRevision: BASE_REVISION,
        completesRun: true,
        commandBatch: COMMAND_BATCH,
    };
}
