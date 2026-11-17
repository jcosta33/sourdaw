import { issueCommandApprovalBinding, parseVersionedCommandBatchEnvelope } from '#/modules/Command/useCases';

import { approvedProjectRevision } from './approvedProjectRevision';
import { type compileAgentRiskApproval } from './compileAgentRiskApproval';
import { readMidiNoteEditApprovalRefusal } from './readMidiNoteEditApprovalRefusal';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type CommandApprovalInput = Parameters<typeof issueCommandApprovalBinding>[0];

type ApprovalBindingRejection = {
    reason: string;
    stale: boolean;
};

export function issueAgentCommandApprovalBinding(input: {
    approval: ReturnType<typeof compileAgentRiskApproval>;
    commandBatch: Pick<CommandApprovalInput, 'authority' | 'serialized'>;
    confirmationId?: string;
    onRejection?: (rejection: ApprovalBindingRejection) => void;
}) {
    const parsed = parseVersionedCommandBatchEnvelope(input.commandBatch.serialized, input.commandBatch.authority);
    const actions =
        parsed.status === 'valid'
            ? parsed.envelope.commands.map((command) => ({
                  type: command.operation,
                  payload: command.arguments,
              }))
            : [];
    return issueCommandApprovalBinding({
        authority: input.commandBatch.authority,
        serialized: input.commandBatch.serialized,
        validate: () => {
            // The same proof confirmation admission and preflight use, so a
            // save or a checkpoint write between them and this binding is no
            // change; the batch's own source revision stays exact.
            const currentRevision = approvedProjectRevision.readValidationRevision(input.approval.sourceRevision);
            const validation = validateAgentRiskApproval({
                approval: input.approval,
                commandBatch: input.commandBatch,
                currentRevision,
                confirmationId: input.confirmationId,
            });
            const selectionRefusal = validation.status === 'valid' ? readMidiNoteEditApprovalRefusal(actions) : null;
            if (selectionRefusal !== null) {
                input.onRejection?.({ reason: selectionRefusal, stale: true });
                return { status: 'invalid', reason: selectionRefusal, stale: true };
            }
            if (validation.status === 'invalid' && input.onRejection) {
                input.onRejection({ reason: validation.reason, stale: validation.stale });
            }
            return validation;
        },
    });
}
