import { executeVersionedCommandBatchEnvelope as executeVersionedCommandBatchEnvelopeRaw } from '../executeVersionedCommandBatchEnvelope';
import { issueCommandApprovalBinding } from '../issueCommandApprovalBinding';

type ExecutionInput = Parameters<typeof executeVersionedCommandBatchEnvelopeRaw>[0];

export function executeApprovedVersionedCommandBatchEnvelope(input: ExecutionInput) {
    if (input.confirmed !== true) {
        return executeVersionedCommandBatchEnvelopeRaw(input);
    }
    const { confirmed: _confirmed, ...execution } = input;
    try {
        return executeVersionedCommandBatchEnvelopeRaw({
            ...execution,
            approvalBinding: issueCommandApprovalBinding({
                authority: input.authority,
                serialized: input.serialized,
                validate: () => ({ status: 'valid' }),
            }),
        });
    } catch {
        return executeVersionedCommandBatchEnvelopeRaw(execution);
    }
}
