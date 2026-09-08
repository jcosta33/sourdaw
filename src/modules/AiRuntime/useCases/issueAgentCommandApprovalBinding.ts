import { issueCommandApprovalBinding } from '#/modules/Command/useCases';
import { captureProjectRevision } from '#/modules/CrdtDocument/useCases';

import { type compileAgentRiskApproval } from './compileAgentRiskApproval';
import { validateAgentRiskApproval } from './validateAgentRiskApproval';

type CommandApprovalInput = Parameters<typeof issueCommandApprovalBinding>[0];

type ApprovalBindingRejection = {
    reason: string;
    stale: boolean;
};

export function issueAgentCommandApprovalBinding(input: {
    approval: ReturnType<typeof compileAgentRiskApproval>;
    commandBatch: Pick<CommandApprovalInput, 'authority' | 'serialized'>;
    onRejection?: (rejection: ApprovalBindingRejection) => void;
}) {
    return issueCommandApprovalBinding({
        authority: input.commandBatch.authority,
        serialized: input.commandBatch.serialized,
        validate: () => {
            const validation = validateAgentRiskApproval({
                approval: input.approval,
                commandBatch: input.commandBatch,
                currentRevision: captureProjectRevision(),
            });
            if (validation.status === 'invalid' && input.onRejection) {
                input.onRejection({ reason: validation.reason, stale: validation.stale });
            }
            return validation;
        },
    });
}
